// E2E-ALBRA-WHATSPOWER-2026 — Parte A: WHATSPOWER → CRM (flujo conversacional → cliente CRM)
// + dedup/idempotencia del inbound
import { DatabaseSync } from 'node:sqlite'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const SECRET = 'e2e-whatspower-secret-2026-32chars!'
const TOKEN = readFileSync('/home/z/my-project/scripts/e2e-wp-token.txt', 'utf8').trim()
const CRM = 'http://localhost:3000'
const WP = 'http://localhost:3003'
const PHONE = '573111222333' // ficticio E2E-WHATSPOWER-CRM-2026
const results = []
function log(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${name} — ${detail}`)
}

function sign(body) { return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex') }

async function main() {
  // ---------- E2E-1: flujo conversacional con crm_action → CRM ----------
  // Flujo: trigger keyword PLAN-E2E → crm_action add_note → send_message
  const flow = {
    id: 'flow_e2e_whatspower_crm_2026',
    name: 'E2E WHATSPOWER-CRM 2026',
    triggerKeywords: ['plan-e2e'],
    isActive: true,
    nodes: [
      { id: 'n1', type: 'trigger', title: 'Trigger E2E', position: { x: 0, y: 0 }, data: { keywords: ['PLAN-E2E'], matchType: 'contains' } },
      { id: 'n2', type: 'crm_action', title: 'Registrar nota en CRM', position: { x: 200, y: 0 }, data: { crmAction: 'add_note', crmParams: { content: 'E2E-WHATSPOWER-CRM-2026: interés registrado desde flujo conversacional' } } },
      { id: 'n3', type: 'send_message', title: 'Confirmación', position: { x: 400, y: 0 }, data: { messageText: 'Gracias, tu solicitud E2E fue registrada en el CRM.' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
  }
  const resFlow = await fetch(`${WP}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) })
  const flowOk = resFlow.ok
  log('E2E-1a', 'Crear flujo en WHATSPOWER con nodo crm_action', flowOk, `status=${resFlow.status}`)

  const eventId1 = `evt_e2e_wp_crm_${Date.now()}`
  const body1 = JSON.stringify({
    eventId: eventId1,
    orgId: 'e2e-whatspower-crm-2026',
    contact: { phone: PHONE, name: 'E2E WhatsPower CRM 2026' },
    message: { text: 'PLAN-E2E quiero información' },
  })
  const resIn1 = await fetch(`${WP}/api/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(body1), 'X-Timestamp': String(Date.now()) },
    body: body1,
  })
  const out1 = await resIn1.json()
  const ok1 = resIn1.status === 200 && out1.handled === true
  log('E2E-1b', 'Inbound firmado procesado por flujo', ok1, `status=${resIn1.status} action=${out1.actionTaken} crmSynced=${out1.crmSynced}`)

  // El router ejecuta acciones CRM: ensureClient (create_client) + add_note → HttpCrmClient real
  await new Promise(r => setTimeout(r, 1500))
  const resClients = await fetch(`${CRM}/api/clients?q=${PHONE}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const clientsData = await resClients.json()
  const list = clientsData.clients || clientsData.items || clientsData || []
  const found = Array.isArray(list) ? list.find(c => c.phone && String(c.phone).includes(PHONE)) : null
  log('E2E-1c', 'CRM persistió el Cliente creado por WHATSPOWER', Boolean(found), found ? `clientId=${found.id} name="${found.name}" source=${found.source}` : JSON.stringify(list).slice(0, 150))

  if (found) {
    const resDetail = await fetch(`${CRM}/api/clients/${found.id}/history`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const detail = await resDetail.json()
    const hist = detail.histories || detail.history || detail.events || []
    const noteE2E = Array.isArray(hist) ? hist.find(h => ((h.title || '') + (h.description || '')).includes('E2E-WHATSPOWER-CRM-2026')) : null
    log('E2E-1d', 'CRM persistió la nota del flujo (ClientHistory)', Boolean(noteE2E), noteE2E ? `historyId=${noteE2E.id} type=${noteE2E.type}` : `status=${resDetail.status} historias=${JSON.stringify(hist).slice(0, 120)}`)
  }

  // ---------- E2E-2: idempotencia del inbound (mismo eventId) ----------
  const resIn2 = await fetch(`${WP}/api/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(body1), 'X-Timestamp': String(Date.now()) },
    body: body1,
  })
  const out2 = await resIn2.json()
  const ok2 = resIn2.status === 200 && out2.actionTaken === 'deduplicated'
  log('E2E-2', 'Evento duplicado → deduplicated (idempotencia WHATSPOWER)', ok2, `status=${resIn2.status} action=${out2.actionTaken}`)

  // ---------- Verificación de persistencia interna WHATSPOWER ----------
  const wpdb = new DatabaseSync('/home/z/repos/WHATSPOWER/db/operational.db', { readOnly: true })
  const locks = wpdb.prepare('SELECT contact_phone, current_state FROM conversation_locks WHERE contact_phone = ?').get(PHONE)
  const msgs = wpdb.prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE contact_phone = ?").get(PHONE) || wpdb.prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE phone = ?").get(PHONE)
  log('E2E-1e', 'WHATSPOWER persistió sesión conversacional (lock + mensajes)', Boolean(locks) && Number(msgs?.n) > 0, `lock=${locks?.current_state ?? '—'} mensajes=${msgs?.n ?? 0}`)
  wpdb.close()

  const fails = results.filter(r => !r.pass).length
  console.log(`\n=== PARTE A: ${results.length - fails}/${results.length} PASS ===`)
  process.exit(fails ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
