// Mock de la Graph API / diálogo OAuth de Meta — SOLO para pruebas E2E locales.
// Emula: dialog/oauth, oauth/access_token, me/accounts, {igId}/subscribed_apps
import http from 'node:http'

const PORT = 3999
const IG_ID = '17841400000000001'
const IG_USER = 'dr.hernanjarringuillen'
const PAGE_ID = '101010101010101'

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`)
  const log = `[mock-meta] ${req.method} ${u.pathname}`
  console.log(log)

  if (u.pathname.endsWith('/dialog/oauth')) {
    // En Meta real esto es el login+consent; en mock devolvemos OK HTML.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body><h1>Mock Meta OAuth Dialog</h1></body></html>')
    return
  }

  if (u.pathname.endsWith('/oauth/access_token')) {
    const isExchange = u.searchParams.get('grant_type') === 'fb_exchange_token'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ access_token: isExchange ? 'LONG-LIVED-TOKEN-MOCK' : 'SHORT-TOKEN-MOCK', token_type: 'bearer' }))
    return
  }

  if (u.pathname.endsWith('/me/accounts')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        data: [
          {
            id: PAGE_ID,
            name: 'Dr. Hernán Jarrín',
            access_token: 'PAGE-TOKEN-MOCK',
            instagram_business_account: { id: IG_ID, username: IG_USER },
          },
        ],
      }),
    )
    return
  }

  if (u.pathname.includes('/subscribed_apps')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      console.log('[mock-meta] subscribed_apps body:', body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `mock: ruta no emulada ${u.pathname}` } }))
})

server.listen(PORT, () => console.log(`mock-meta escuchando en :${PORT}`))
