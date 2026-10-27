// Stub FIEL del daemon WhatsApp (:3012) — valida Bearer INTERNAL_API_SECRET y registra despachos en fichero.
// Sin envíos reales: solo autenticación + registro. Modos: normal, slow (timeout), malformed (falso-200 no JSON).
import http from 'node:http'
import { appendFileSync } from 'node:fs'
const SECRET = process.env.STUB_SECRET || 'dev'
const LOG = process.env.STUB_LOG || '/tmp/stub-dispatches.jsonl'
const MODE = process.env.STUB_MODE || 'normal'
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
    if (MODE === 'slow') { setTimeout(() => { try { res.writeHead(200); res.end('{"success":true}') } catch {} }, 8000); return }
    const parsed = JSON.parse(body || '{}')
    appendFileSync(LOG, JSON.stringify({ to: parsed.to, textLen: (parsed.text || '').length, at: new Date().toISOString() }) + '\n')
    if (MODE === 'malformed') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>ok</html>'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, messageId: 'stub-' + Date.now() }))
  })
})
server.listen(3012, () => console.log('[STUB] daemon fiel en :3012 modo=' + MODE))
setInterval(() => {}, 60000)
