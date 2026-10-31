// Mock de TikTok Open API / Login Kit — SOLO para pruebas E2E locales.
// Emula: /v2/auth/authorize/, /v2/oauth/token/ (POST form), /v2/user/info/,
// y un endpoint de envío Business Messaging configurable (/v2/business/message/send/).
import http from 'node:http'

const PORT = 3998

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`)
  console.log(`[mock-tiktok] ${req.method} ${u.pathname}`)

  if (u.pathname.startsWith('/v2/auth/authorize')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body><h1>Mock TikTok Login Kit</h1></body></html>')
    return
  }

  if (u.pathname === '/v2/oauth/token/' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      console.log('[mock-tiktok] token body:', body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          access_token: 'TT-ACCESS-MOCK',
          refresh_token: 'TT-REFRESH-MOCK',
          open_id: 'TT-OPENID-7300000000000000001',
          scope: 'user_info.basic',
          token_type: 'access_token',
          expires_in: 86400,
        }),
      )
    })
    return
  }

  if (u.pathname === '/v2/user/info/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        data: { user: { open_id: 'TT-OPENID-7300000000000000001', display_name: 'johanbravo0830' } },
      }),
    )
    return
  }

  if (u.pathname.includes('message')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      console.log('[mock-tiktok] send body:', body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { message_id: 'TT-MSG-MOCK-1' } }))
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `mock: ruta no emulada ${u.pathname}` } }))
})

server.listen(PORT, () => console.log(`mock-tiktok escuchando en :${PORT}`))
