// Mock de Google OAuth para pruebas E2E del CRM ALBRA (:3998).
// Imita accounts.google.com (diálogo), oauth2.googleapis.com (token) y
// openidconnect.googleapis.com (userinfo). NUNCA en producción: solo se usa
// vía GOOGLE_AUTH_BASE / GOOGLE_TOKEN_BASE / GOOGLE_USERINFO_BASE en tests.
import http from 'node:http'

const PORT = 3998
const CLIENT_ID_OK = 'MOCK-CLIENT-ID.apps.googleusercontent.com'
const SECRET_OK = 'MOCK-SECRET-OK'
const AT = 'MOCK-AT-123'
const RT = 'MOCK-RT-456'

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString()
    const url = new URL(req.url, `http://localhost:${PORT}`)
    console.log(`[mock-google] ${req.method} ${url.pathname}`)

    // Diálogo OAuth (no se usa directamente en el E2E; el CRM solo redirige aquí)
    if (url.pathname === '/o/oauth2/v2/auth') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h1>Acceder con Google — mock</h1><p>Elige una cuenta</p></body></html>')
      return
    }

    // Endpoint de tokens
    if (url.pathname === '/token' && req.method === 'POST') {
      const params = new URLSearchParams(body)
      const grant = params.get('grant_type')
      const secret = params.get('client_secret')
      if (secret !== SECRET_OK) {
        console.log('[mock-google] token rechazado: client_secret inválido')
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Unauthorized' }))
        return
      }
      if (grant === 'authorization_code') {
        console.log('[mock-google] authorization_code → tokens emitidos')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          access_token: AT,
          refresh_token: RT,
          expires_in: 3599,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar openid',
        }))
        return
      }
      if (grant === 'refresh_token') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ access_token: AT + '-REFRESHED', expires_in: 3599, token_type: 'Bearer' }))
        return
      }
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unsupported_grant_type' }))
      return
    }

    // Identidad de la cuenta (userinfo)
    if (url.pathname === '/v1/userinfo') {
      const auth = req.headers.authorization || ''
      if (!auth.startsWith(`Bearer ${AT}`)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_credentials' }))
        return
      }
      console.log('[mock-google] userinfo → albragroup8@gmail.com')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        sub: '100000000000000000001',
        email: 'albragroup8@gmail.com',
        name: 'ALBRA GROUP',
        verified_email: true,
        picture: 'https://mock.google/picture.jpg',
      }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found', path: url.pathname }))
  })
})

server.listen(PORT, () => console.log(`[mock-google] escuchando :${PORT}`))
