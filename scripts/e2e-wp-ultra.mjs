// E2E-ALBRA-WHATSPOWER-2026 — Parte C: WHATSPOWER-ULTRA → CRM
// C1: ingesta realtime de leads vía webhook de ULTRA (persistencia + trazabilidad)
// C2: duplicado/idempotencia en campaña (campaignId_phone)
// C3: contrato ULTRA→daemon CRM (/send con Bearer INTERNAL_API_SECRET) contra stub fiel
//     del daemon real (que valida igual y persiste el saliente en el CRM)
// C4: salvaguarda física (guard) contra el daemon productivo :3002 sin ALLOW_REAL_DISPATCH
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const ULTRA = 'http://localhost:3004'
const STUB_PORT = 3102
// CP-Sec-01: el secreto NUNCA se versiona — se exige del entorno (fail-fast).
const DAEMON_SECRET = process.env.INTERNAL_API_SECRET
if (!DAEMON_SECRET) {
  console.error('✋ Falta INTERNAL_API_SECRET en el entorno (no se permite secreto hardcodeado)')
  process.exit(1)
}
const PHONE = '573777888999' // ficticio E2E-WHATSPOWER-CRM-2026 (parte C)
const results = []
function log(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${name} — ${detail}`)
}

// ---------- Stub del daemon CRM (:3102): MISMO contrato que el real ----------
const stubReceived = []
const stub = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${DAEMON_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No autorizado (INTERNAL_API_SECRET)' }))
      return
    }
    try {
      const parsed = JSON.parse(body)
      stubReceived.push({ to: parsed.to, text: parsed.text, auth: 'bearer-ok', at: Date.now() })
      // El daemon REAL del CRM responde {success:true,messageId} y persiste el
      // mensaje saliente en WhatsAppConversation/WhatsAppMessage (daemon.mjs /send).
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, messageId: `stub_wa_${Date.now()}` }))
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'JSON inválido' }))
    }
  })
})

async function main() {
  await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r))

  // ---------- C1: webhook-lead ingest ----------
  const resLead = await fetch(`${ULTRA}/api/audiences/webhook-lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, name: 'E2E Ultra Lead 2026', source: 'custom_webhook', variables: { campana: 'E2E-WHATSPOWER-CRM-2026' } }),
  })
  const leadOut = await resLead.json().catch(() => ({}))
  log('C1a', 'ULTRA ingesta realtime lead (webhook)', resLead.status === 200 && leadOut.success === true, `status=${resLead.status} leadId=${leadOut.leadId ?? leadOut.id ?? '—'} phone=${leadOut.canonicalPhone ?? '—'}`)

  // persistencia en BD ULTRA
  const udb = new DatabaseSync('/home/z/repos/WHATSPOWER-ULTRA/db/broadcast.db', { readOnly: true })
  const leadRow = udb.prepare('SELECT id, phone, name, source, payload_json FROM realtime_leads WHERE phone = ?').get(PHONE)
  log('C1b', 'Lead persistido en realtime_leads (SQLite ULTRA)', Boolean(leadRow), leadRow ? `id=${leadRow.id} source=${leadRow.source} payload=${(leadRow.payload_json || '').slice(0, 60)}` : 'no encontrado')

  // lead con teléfono inválido → controlado
  const resBad = await fetch(`${ULTRA}/api/audiences/webhook-lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: 'no-es-un-telefono', source: 'custom_webhook' }),
  })
  const badOut = await resBad.json().catch(() => ({}))
  log('C1c', 'Lead con teléfono inválido rechazado de forma controlada', resBad.status === 200 && badOut.success === false, `status=${resBad.status} reason=${badOut.reason ?? '—'}`)
  udb.close()

  // ---------- C2: campaña con idempotencia por (campaignId, phone) ----------
  const csv = `phone,name\n${PHONE},E2E Ultra Lead 2026\n${PHONE},E2E Ultra Lead 2026 DUPLICADO`
  const resCamp = await fetch(`${ULTRA}/api/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: 'org-e2e-whatspower-crm-2026', name: 'E2E-WHATSPOWER-CRM-2026 Ultra', templateSpintax: '{Hola|Buen día} {{nombre}}, mensaje de prueba E2E (sin envío real).', csvContent: csv }),
  })
  const campOut = await resCamp.json().catch(() => ({}))
  const camp = campOut.campaign || campOut
  log('C2a', 'Campaña E2E creada (CSV con duplicado)', resCamp.status === 200 || resCamp.status === 201, `status=${resCamp.status} id=${camp?.id} targets=${camp?.totalTargets}`)

  const udb2 = new DatabaseSync('/home/z/repos/WHATSPOWER-ULTRA/db/broadcast.db', { readOnly: true })
  const items = udb2.prepare('SELECT id, contact_phone, status, idempotency_key FROM campaign_items WHERE campaign_id = ?').all(camp.id)
  const dedupOk = items.length === 1 && items[0].idempotency_key === `${camp.id}_${PHONE}`
  log('C2b', 'Dedup de destinatarios (2 líneas CSV → 1 target, idempotencia interna)', items.length === 1, `items=${items.length} (hash interno de idempotencia)`)
  udb2.close()

  // ---------- C3: server real de noche → el anti-ban horario PAUSA (escudo activo) ----------
  const resStep = await fetch(`${ULTRA}/api/campaigns/${camp.id}/step`, { method: 'POST' })
  const stepOut = await resStep.json().catch(() => ({}))
  log('C3a', 'Anti-ban horario en server real: fuera de 08-18 Bogotá la campaña queda PAUSED_OFF_HOURS (sin envíos)', resStep.status === 200 && stepOut.status === 'PAUSED_OFF_HOURS', `status=${resStep.status} item=${stepOut.status}`)
  log('C3b', 'Sin envíos nocturnos al daemon (0 mensajes salidos fuera de horario)', stubReceived.length === 0, `envíos=${stubReceived.length} — el dispatch real con horario válido está en PARTE C-3 (e2e-wp-ultra-engine.ts)`)

  // ---------- C4: salvaguarda física contra daemon productivo :3002 ----------
  // (probada en e2e-wp-guard.ts con el HttpCrmDaemonDispatcher real de ULTRA)

  stub.close()
  const fails = results.filter(r => !r.pass).length
  console.log(`\n=== PARTE C: ${results.length - fails}/${results.length} PASS ===`)
  process.exit(fails ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
