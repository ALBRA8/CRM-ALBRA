// Mock del diálogo OAuth + Graph API de Meta para MESSENGER — SOLO pruebas E2E locales.
// Emula: /v21.0/dialog/oauth (valida client_id+redirect_uri+state → 302 al callback con code),
// /v21.0/oauth/access_token (valida code → user token), /v21.0/me (email del autorizador),
// /v21.0/me/accounts (2 páginas de prueba; la primera es la que elige el CRM) y
// /v21.0/{pageId}/subscribed_apps (200). Todo local, sin secretos reales.
import http from 'node:http'

const PORT = 3998
const APP_ID_MOCK = '1234567890123456'
const CODE_MOCK = 'FB-MOCK-CODE'
const USER_TOKEN = 'FB-USER-TOKEN-MOCK'
const PAGE_ID_1 = '101010101010102'
const PAGE_1 = { id: PAGE_ID_1, name: 'Página ALRA Mock', access_token: 'FB-PAGE-TOKEN-MOCK' }
const PAGE_2 = { id: '999999999999998', name: 'Página Secundaria Mock', access_token: 'FB-PAGE-TOKEN-2-MOCK' }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`)
  console.log(`[mock-messenger] ${req.method} ${u.pathname}`)

  // Diálogo OAuth: valida client_id + redirect_uri + state y 302 al callback con code
  if (u.pathname.endsWith('/dialog/oauth')) {
    const clientId = u.searchParams.get('client_id') || ''
    const redirectUri = u.searchParams.get('redirect_uri') || ''
    const state = u.searchParams.get('state') || ''
    if (clientId !== APP_ID_MOCK || !redirectUri.includes('/api/facebook/oauth/callback') || state.split('.').length !== 4) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'mock-dialog: client_id/redirect_uri/state inválidos' } }))
      return
    }
    console.log(`[mock-messenger] dialog ok client_id=${clientId} redirect_uri=${redirectUri}`)
    const back = new URL(redirectUri)
    back.searchParams.set('code', CODE_MOCK)
    back.searchParams.set('state', state)
    res.writeHead(302, { Location: back.toString() })
    res.end()
    return
  }

  // Intercambio code → user access token
  if (u.pathname.endsWith('/oauth/access_token')) {
    const code = u.searchParams.get('code') || ''
    const clientId = u.searchParams.get('client_id') || ''
    const clientSecret = u.searchParams.get('client_secret') || ''
    const redirectUri = u.searchParams.get('redirect_uri') || ''
    if (code !== CODE_MOCK || clientId !== APP_ID_MOCK || !clientSecret || !redirectUri.includes('/api/facebook/oauth/callback')) {
      console.log(`[mock-messenger] token RECHAZADO code=${code ? 'presente' : 'ausente'}`)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'mock: code/client_id/client_secret inválidos' } }))
      return
    }
    console.log(`[mock-messenger] token code=${code} → user token emitido`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ access_token: USER_TOKEN, token_type: 'bearer' }))
    return
  }

  // Perfil de quien autorizó (email)
  if (u.pathname === '/v21.0/me') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ id: 'FB-USER-MOCK', name: 'Autorizador Mock', email: 'messenger.mock@albra.test' }))
    return
  }

  // Páginas del usuario (elige la PRIMERA el CRM)
  if (u.pathname.endsWith('/me/accounts')) {
    if (!u.searchParams.get('access_token')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'mock: falta access_token' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [PAGE_1, PAGE_2] }))
    return
  }

  // Suscripción de la Página a los webhooks de la app
  if (u.pathname.includes('/subscribed_apps')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      console.log(`[mock-messenger] subscribed_apps body: ${body}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `mock: ruta no emulada ${u.pathname}` } }))
})

server.listen(PORT, () => console.log(`mock-messenger escuchando en :${PORT}`))
