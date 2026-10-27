// E2E FINAL — FLUJO 1: WHATSPOWER → CRM (evento entrante sintético → CRM actions → persistencia + idempotencia + rechazos)
// Evidencia sanitizada (sin secretos) → download/ALBRA-PRUEBA-INTEGRAL/evidencias/e2e/A-whatspower-crm.txt
import { createHmac } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

const WP = 'http://localhost:3003'
const CRM_DB = '/home/z/my-project/albra-final/e2e/crm-e2e.db'
const EVID_DIR = '/home/z/my-project/download/ALBRA-PRUEBA-INTEGRAL/evidencias/e2e'
const { E2E_WP_SECRET } = process.env
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync(EVID_DIR, { recursive: true })

const phone = '573000000102'
const body = JSON.stringify({
  eventId: 'e2e-final-A-' + Date.now(),
  orgId: 'org_e2e_final',
  contact: { phone, name: 'E2E Final Cliente' },
  message: { text: 'e2e2026' },
  timestamp: new Date().toISOString(),
  channel: 'whatsapp',
})
const sign = (payload, secret, ts) => createHmac('sha256', secret).update(payload).digest('hex')

async function inbound(payload, sig, ts) {
  const res = await fetch(`${WP}/api/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sig, 'X-Timestamp': String(ts ?? Date.now()) },
    body: payload,
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

// 1. Flujo con crm_action add_note (ensureClient crea cliente en CRM) + respuesta Mock (sin envío real)
const flow = {
  id: 'flow_e2e_final_a',
  name: 'E2E Final A',
  triggerKeywords: ['e2e2026'],
  isActive: true,
  nodes: [
    { id: 't', type: 'trigger', title: 'trigger', data: { keywords: ['e2e2026'] } },
    { id: 'an', type: 'crm_action', title: 'nota CRM', data: { crmAction: 'add_note', crmParams: { content: 'Nota E2E-WHATSPOWER-CRM-2026 final' } } },
    { id: 'sm', type: 'send_message', title: 'respuesta', data: { messageText: 'Registro completado E2E' } },
  ],
  edges: [{ source: 't', target: 'an' }, { source: 'an', target: 'sm' }],
}
const fr = await fetch(`${WP}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) })
line(`A0 flujo creado: HTTP ${fr.status} PASS=${fr.status === 200}`)

// 2. Inbound firmado → ejecuta flujo y sincroniza CRM (cliente real vía HttpCrmClient)
const r1 = await inbound(body, sign(body, E2E_WP_SECRET))
line(`A1 inbound firmado: HTTP ${r1.status} actionTaken=${r1.json.actionTaken} crmSynced=${r1.json.crmSynced} PASS=${r1.status === 200 && r1.json.crmSynced === true}`)

// 3. Idempotencia: mismo eventId → deduplicated, sin duplicar efecto
const r2 = await inbound(body, sign(body, E2E_WP_SECRET))
line(`A2 idempotencia (mismo eventId): HTTP ${r2.status} actionTaken=${r2.json.actionTaken} PASS=${r2.json.actionTaken === 'deduplicated'}`)

// 4. Persistencia en CRM (lectura directa BD)
const db = new Database(CRM_DB, { readonly: true, timeout: 20000 })
const client = db.prepare("SELECT id, name, phone, source FROM Client WHERE phone LIKE ? ORDER BY createdAt DESC LIMIT 1").get(`%${phone}%`)
line(`A3 cliente en CRM: ${client ? `id=${client.id.slice(0, 8)}… name=${client.name} source=${client.source ?? 'n/a'}` : 'NO ENCONTRADO'} PASS=${!!client}`)
let hist = null
if (client) {
  hist = db.prepare('SELECT id, title, description FROM ClientHistory WHERE clientId = ? ORDER BY createdAt DESC LIMIT 1').get(client.id)
}
const histTxt = hist ? `${hist.title || ''} ${hist.description || ''}` : ''
line(`A4 historial en CRM: ${hist ? `contenido="${histTxt.slice(0, 60)}"` : 'NO ENCONTRADO'} PASS=${histTxt.includes('E2E-WHATSPOWER-CRM-2026')}`)

// 5. Controles: firma inválida, replay, payload incompleto
const bad = await inbound(body, 'firma_invalida_completa_000000')
line(`A5 firma inválida: HTTP ${bad.status} PASS=${bad.status === 401}`)
const oldTs = Date.now() - 400_000
const r3 = await inbound(body, sign(body, E2E_WP_SECRET, oldTs), oldTs)
line(`A6 replay (timestamp -400s): HTTP ${r3.status} PASS=${r3.status === 401}`)
const inc = JSON.stringify({ eventId: 'e2e-inc-1', orgId: 'org_e2e_final', contact: { phone } })
const r4 = await inbound(inc, sign(inc, E2E_WP_SECRET))
line(`A7 payload incompleto: HTTP ${r4.status} PASS=${r4.status === 400}`)

// 6. Duplicado de teléfono: segundo inbound con otro eventId y mismo teléfono → CRM rechaza controladamente (no duplicado silencioso)
const bodyDup = JSON.stringify({ ...JSON.parse(body), eventId: 'e2e-final-A-dup-' + Date.now() })
const r5 = await inbound(bodyDup, sign(bodyDup, E2E_WP_SECRET))
line(`A8 repetición mismo teléfono (evento nuevo): HTTP ${r5.status} crmSynced=${r5.json.crmSynced} (rechazo controlado o sincronización idempotente por el CRM)`)

db.close()
writeFileSync(`${EVID_DIR}/A-whatspower-crm.txt`, EVID.join('\n') + '\n')
console.log('EVIDENCIA A guardada')
