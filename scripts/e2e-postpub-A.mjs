// E2E post-publicación — PRUEBA A: WHATSPOWER → CRM (cliente + historial + idempotencia) y batería de errores
// Evidencia sin secretos → download/e2e-postpub/A-whatspower-crm.txt
import { createHmac } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

const WP = 'http://localhost:3003'
const { WP_SECRET } = process.env
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync('/home/z/my-project/download/e2e-postpub', { recursive: true })

const phone = '573000000102'
const body = JSON.stringify({
  eventId: 'e2e-wp-crm-2026-postpub-b1',
  orgId: 'org_e2e_postpub',
  contact: { phone, name: 'E2E PostPub Cliente' },
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

// 1. Flujo con crm_action add_note (ensureClient crea cliente en CRM)
const flow = {
  id: 'flow_e2e_postpub_a',
  name: 'E2E PostPub A',
  triggerKeywords: ['e2e2026'],
  isActive: true,
  nodes: [
    { id: 't', type: 'trigger', title: 'trigger', data: { keywords: ['e2e2026'] } },
    { id: 'an', type: 'crm_action', title: 'nota CRM', data: { crmAction: 'add_note', crmParams: { content: 'Nota E2E-WHATSPOWER-CRM-2026 post-publicación' } } },
    { id: 'sm', type: 'send_message', title: 'respuesta', data: { messageText: 'Registro completado E2E' } },
  ],
  edges: [{ source: 't', target: 'an' }, { source: 'an', target: 'sm' }],
}
const fr = await fetch(`${WP}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) })
line(`A0 flujo creado: HTTP ${fr.status}`)

// 2. Inbound firmado → debe ejecutar flujo y sincronizar CRM
const r1 = await inbound(body, sign(body, WP_SECRET))
line(`A1 inbound firmado: HTTP ${r1.status} actionTaken=${r1.json.actionTaken} crmSynced=${r1.json.crmSynced}`)
line(`A1 PASS=${r1.status === 200 && r1.json.crmSynced === true}`)

// 3. Idempotencia: mismo eventId
const r2 = await inbound(body, sign(body, WP_SECRET))
line(`A2 idempotencia (mismo eventId): HTTP ${r2.status} actionTaken=${r2.json.actionTaken} PASS=${r2.json.actionTaken === 'deduplicated'}`)

// 4. Persistencia en CRM (BD directa, readonly)
const db = new Database('/home/z/my-project/db/custom.db', { readonly: true })
const client = db.prepare("SELECT id, name, phone, source FROM Client WHERE phone LIKE ? ORDER BY createdAt DESC LIMIT 1").get(`%${phone}%`)
line(`A3 cliente en CRM: ${client ? `id=${client.id.slice(0,8)}… name=${client.name} source=${client.source ?? 'n/a'}` : 'NO ENCONTRADO'}`)
let hist = null
if (client) {
  hist = db.prepare('SELECT id, title, description FROM ClientHistory WHERE clientId = ? ORDER BY createdAt DESC LIMIT 1').get(client.id)
  if (hist) hist.content = `${hist.title || ''} ${hist.description || ''}`
}
line(`A4 historial en CRM: ${hist ? `contenido="${String(hist.content).slice(0, 60)}"` : 'NO ENCONTRADO'}`)
line(`A4 PASS=${!!client && !!hist && String(hist?.content || '').includes('E2E-WHATSPOWER-CRM-2026')}`)

// 5. Batería de errores WHATSPOWER
const bad = await inbound(body, 'firma_invalida_completa_000000')
line(`A5 firma inválida: HTTP ${bad.status} PASS=${bad.status === 401}`)
const oldTs = Date.now() - 400_000
const r3 = await inbound(body, sign(body, WP_SECRET, oldTs), oldTs)
line(`A6 replay (timestamp -400s): HTTP ${r3.status} PASS=${r3.status === 401}`)
const inc = JSON.stringify({ eventId: 'e2e-inc-1', orgId: 'org_e2e_postpub', contact: { phone } })
const r4 = await inbound(inc, sign(inc, WP_SECRET))
line(`A7 payload incompleto: HTTP ${r4.status} PASS=${r4.status === 400}`)
db.close()

writeFileSync('/home/z/my-project/download/e2e-postpub/A-whatspower-crm.txt', EVID.join('\n') + '\n')
console.log('EVIDENCIA A guardada')
