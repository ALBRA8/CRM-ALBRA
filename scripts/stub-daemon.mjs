// Stub FIEL del daemon WhatsApp (:3012) — valida Bearer INTERNAL_API_SECRET y registra despachos en fichero.
// Usado SOLO para verificar autenticación y persistencia de despacho SIN envíos reales.
import http from 'node:http'
import { appendFileSync } from 'node:fs'
const SECRET = process.env.STUB_SECRET || 'dev'
const LOG = '/home/z/my-project/download/e2e-postpub/stub-dispatches.jsonl'
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <INTERNAL_API_SECRET> header' }))
      return
    }
    const parsed = JSON.parse(body || '{}')
    appendFileSync(LOG, JSON.stringify({ to: parsed.to, textLen: (parsed.text || '').length, at: new Date().toISOString() }) + '\n')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, messageId: 'stub-' + Date.now() }))
  })
})
server.listen(3012, () => console.log('[STUB] daemon fiel en :3012'))
setInterval(() => {}, 60000)
