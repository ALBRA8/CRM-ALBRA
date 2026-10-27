// Smoke: POST /api/inbound con payload estilo README SIN correlationId → debe ser 200 (antes 500)
import { createHmac } from 'node:crypto'
import { createAgenticServer } from '/home/z/repos/WHATSPOWER/src/server.ts'

const { server } = createAgenticServer({ dbPath: ':memory:' })
// @ts-ignore — script de smoke en JS plano
await new Promise((r) => server.listen(0, '127.0.0.1', () => r()))
const port = server.address().port

const payload = JSON.stringify({
  eventId: 'e2e-wp-crm-2026-smoke-001',
  orgId: 'org_e2e_wp',
  contact: { phone: '573000000002', name: 'Smoke Test' },
  message: { text: 'Hola, quiero información' },
  timestamp: new Date().toISOString(),
  channel: 'whatsapp',
})
// Sin correlationId en el payload (caso del README que provocaba el crash 500)

const sig = createHmac('sha256', 'dev_secret_shared_albra_2a').update(payload).digest('hex')
const res = await fetch(`http://127.0.0.1:${port}/api/inbound`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sig },
  body: payload,
})
const body = await res.json()
console.log('STATUS:', res.status)
console.log('RESPUESTA:', JSON.stringify(body).slice(0, 160))
console.log(res.status === 200 ? 'SMOKE PASS (correlationId fallback OK)' : 'SMOKE FAIL')
server.close()
process.exit(res.status === 200 ? 0 : 1)
