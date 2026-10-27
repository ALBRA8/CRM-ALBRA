// E2E-ALBRA-WHATSPOWER-2026 — Parte D: batería de errores controlados
// Ningún proceso debe colgarse; ningún dato corrompido; errores con código claro.
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const SECRET = 'e2e-whatspower-secret-2026-32chars!'
const KEY = readFileSync('/home/z/my-project/scripts/e2e-wp-key.txt', 'utf8').trim()
const TOKEN = readFileSync('/home/z/my-project/scripts/e2e-wp-token.txt', 'utf8').trim()
const CRM = 'http://localhost:3000'
const WP = 'http://localhost:3003'
const results = []
function log(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${name} — ${detail}`)
}
function sign(body, secret = SECRET) { return createHmac('sha256', secret).update(body, 'utf8').digest('hex') }

async function main() {
  // D1: CRM actions sin auth
  let r = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_client', params: { name: 'x' } }) })
  log('D1', 'CRM /api/crm/actions sin autenticación → 401', r.status === 401, `status=${r.status}`)

  // D2: API key inválida
  r = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer albra_invalida_e2e' }, body: JSON.stringify({ action: 'create_client', params: { name: 'x' } }) })
  log('D2', 'CRM /api/crm/actions con API key inválida → 401', r.status === 401, `status=${r.status}`)

  // D3: acción desconocida → 400 con catálogo (controlado)
  r = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ action: 'borrar_todo', params: {} }) })
  const d3 = await r.json().catch(() => ({}))
  log('D3', 'CRM acción desconocida → 400 con catálogo disponible', r.status === 400 && Array.isArray(d3.available), `status=${r.status} disponibles=${(d3.available || []).length}`)

  // D4: endpoint inexistente
  r = await fetch(`${CRM}/api/no-existe-e2e`)
  log('D4', 'CRM endpoint inexistente → 404', r.status === 404, `status=${r.status}`)

  // D5: WHATSPOWER inbound con firma inválida
  const bodyOk = JSON.stringify({ eventId: `evt_err_${Date.now()}`, orgId: 'org-e2e', contact: { phone: '573111000000' }, message: { text: 'hola error controlado' } })
  r = await fetch(`${WP}/api/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': 'firma_falsa' }, body: bodyOk })
  log('D5', 'WHATSPOWER inbound firma inválida → 401', r.status === 401, `status=${r.status}`)

  // D6: replay (timestamp antiguo > 300s)
  r = await fetch(`${WP}/api/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(bodyOk), 'X-Timestamp': String(Date.now() - 400_000) }, body: bodyOk })
  log('D6', 'WHATSPOWER inbound timestamp expirado (replay) → 401', r.status === 401, `status=${r.status}`)

  // D7: payload incompleto
  const bodyBad = JSON.stringify({ eventId: `evt_err2_${Date.now()}`, orgId: 'org-e2e' })
  r = await fetch(`${WP}/api/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(bodyBad), 'X-Timestamp': String(Date.now()) }, body: bodyBad })
  log('D7', 'WHATSPOWER inbound payload incompleto → 400', r.status === 400, `status=${r.status}`)

  // D8: webhook Meta del CRM con firma inválida → 401 (no llega a WHATSPOWER)
  r = await fetch(`${CRM}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' }, body: JSON.stringify({ object: 'x', entry: [] }) })
  log('D8', 'CRM webhook Meta firma inválida → 401 (sin reenvío a WHATSPOWER)', r.status === 401, `status=${r.status}`)

  // D9: WHATSPOWER → CRM CAÍDO: fail-open controlado (flujo continúa, crmSynced=false, proceso vivo)
  let crmAlive = false
  const deadCrm = createServer(() => { crmAlive = true })
  await new Promise((resolve) => deadCrm.listen(0, '127.0.0.1', resolve))
  const deadPort = deadCrm.address().port
  deadCrm.close()
  const { createAgenticServer } = await import('/home/z/repos/WHATSPOWER/src/server.ts')
  const { HttpCrmClient } = await import('/home/z/repos/WHATSPOWER/src/adapters/crm-client.ts')
  const { MockTransportSender } = await import('/home/z/repos/WHATSPOWER/src/adapters/transport.ts')
  process.env.AGENTIC_2A_WEBHOOK_SECRET = SECRET // mismo secret para el server efímero
  const { server: wpDead, router } = createAgenticServer({
    dbPath: ':memory:',
    transport: new MockTransportSender(),
    crm: new HttpCrmClient(`http://127.0.0.1:${deadPort}`, KEY),
  })
  await new Promise((resolve) => wpDead.listen(0, '127.0.0.1', resolve))
  const wpDeadPort = wpDead.address().port
  const bodyDead = JSON.stringify({ eventId: `evt_dead_${Date.now()}`, orgId: 'org-e2e', contact: { phone: '573222333444', name: 'E2E CRM caído' }, message: { text: 'PLAN-E2E mensaje con CRM caído' } })
  const t0 = Date.now()
  r = await fetch(`http://127.0.0.1:${wpDeadPort}/api/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(bodyDead) }, body: bodyDead })
  const outDead = await r.json().catch(() => ({}))
  const dt = Date.now() - t0
  log('D9', 'CRM caído → WHATSPOWER responde controlado (fail-open, sin colgar)', r.status === 200 && dt < 10000, `status=${r.status} crmSynced=${outDead.crmSynced} latencia=${dt}ms`)
  // el proceso sigue vivo para el siguiente mensaje
  const bodyAfter = JSON.stringify({ eventId: `evt_after_${Date.now()}`, orgId: 'org-e2e', contact: { phone: '573222333444' }, message: { text: 'BAJA' } })
  r = await fetch(`http://127.0.0.1:${wpDeadPort}/api/inbound`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(bodyAfter) }, body: bodyAfter })
  const outAfter = await r.json().catch(() => ({}))
  log('D9b', 'WHATSPOWER sigue operativo tras fallo de CRM (siguiente evento OK)', r.status === 200 && outAfter.actionTaken === 'suppression_opt_out', `status=${r.status} action=${outAfter.actionTaken}`)
  wpDead.close()

  const fails = results.filter((x) => !x.pass).length
  console.log(`\n=== PARTE D: ${results.length - fails}/${results.length} PASS ===`)
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })
