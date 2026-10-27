// E2E-ALBRA-WHATSPOWER-2026 — Parte B: CRM → WHATSPOWER
// B1: Inbound bridge (webhook Meta firmado → CRM procesa → reenvía firmado a WHATSPOWER)
// B2: Stage-change bridge (PUT opportunity → CRM notifica → WHATSPOWER dispara trigger)
// B3: direct al stage-change endpoint (contrato del receptor WHATSPOWER)
import { DatabaseSync } from 'node:sqlite'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const TOKEN = readFileSync('/home/z/my-project/scripts/e2e-wp-token.txt', 'utf8').trim()
const CRM = 'http://localhost:3000'
const WP = 'http://localhost:3003'
const META_SECRET = 'e2e_meta_app_secret_whatspower_2026'
const PHONE = '573444555666' // ficticio E2E-WHATSPOWER-CRM-2026 (parte B)
const results = []
function log(id, name, pass, detail) {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${name} — ${detail}`)
}

async function main() {
  // ---------- B1: webhook Meta firmado → CRM → bridge → WHATSPOWER ----------
  const wpdbBefore = new DatabaseSync('/home/z/repos/WHATSPOWER/db/operational.db', { readOnly: true })
  const before = wpdbBefore.prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE text LIKE '%E2E-BRIDGE-2026%'").get()
  wpdbBefore.close()

  const waEventId = `wamid.E2EBRIDGE${Date.now()}`
  const metaBody = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'E2E-WABA-ID',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '573000000000', phone_number_id: 'E2E-PHONE-ID-2026' },
          contacts: [{ wa_id: PHONE, profile: { name: 'E2E Bridge CRM 2026' } }],
          messages: [{ from: PHONE, id: waEventId, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: 'E2E-BRIDGE-2026 mensaje entrante al CRM para WHATSPOWER' }, type: 'text' }],
        },
      }],
    }],
  }
  const rawBody = JSON.stringify(metaBody)
  const metaSig = 'sha256=' + createHmac('sha256', META_SECRET).update(rawBody, 'utf8').digest('hex')

  const resHook = await fetch(`${CRM}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': metaSig },
    body: rawBody,
  })
  const hookText = await resHook.text()
  log('B1a', 'CRM procesa webhook Meta firmado (org match por secret)', resHook.status === 200, `status=${resHook.status} body=${hookText.slice(0, 100)}`)

  // El CRM (fire-and-forget) reenvió el evento a WHATSPOWER con HMAC. Verificar efecto:
  await new Promise(r => setTimeout(r, 2500))
  const wpdb = new DatabaseSync('/home/z/repos/WHATSPOWER/db/operational.db', { readOnly: true })
  const after = wpdb.prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE text LIKE '%E2E-BRIDGE-2026%'").get()
  const flowSession = wpdb.prepare('SELECT contact_phone, current_state FROM conversation_locks WHERE contact_phone LIKE ?').get(`%${PHONE}%`)
  wpdb.close()
  log('B1b', 'Bridge CRM→WHATSPOWER entregó el evento (persistido en WhatsPower)', Number(after?.n) > Number(before?.n ?? 0), `mensajes_e2e=${after?.n ?? 0} (antes=${before?.n ?? 0}) lock=${flowSession?.current_state ?? '—'}`)

  // ---------- B2: stage-change real vía API del CRM ----------
  // Crear oportunidad para el cliente E2E y moverla de etapa
  const resClients = await fetch(`${CRM}/api/clients?q=${PHONE}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const clientsData = await resClients.json()
  const list = clientsData.clients || clientsData.items || clientsData || []
  const client = Array.isArray(list) ? list.find(c => c.phone && String(c.phone).includes(PHONE)) : null
  log('B2a', 'Cliente B existe en CRM (creado por canal WhatsApp)', Boolean(client), client ? `clientId=${client.id}` : 'no encontrado')

  if (client) {
    const resOpp = await fetch(`${CRM}/api/opportunities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: client.id, title: 'Oportunidad E2E-WHATSPOWER-CRM-2026', amount: 1200 }),
    })
    const oppData = await resOpp.json()
    const opp = oppData.opportunity || oppData
    log('B2b', 'Oportunidad E2E creada en CRM', resOpp.status === 200 || resOpp.status === 201, `status=${resOpp.status} id=${opp?.id}`)

    const resStages = await fetch(`${CRM}/api/pipeline`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const stagesData = await resStages.json()
    const stages = stagesData.stages || stagesData || []
    const target = Array.isArray(stages) ? (stages.find(s => /propuesta/i.test(s.name || '')) || stages[1] || stages[0]) : null
    log('B2c', 'Etapas de pipeline disponibles', Boolean(target?.id), `target=${target?.name ?? '—'}`)

    if (opp?.id && target?.id) {
      const resPut = await fetch(`${CRM}/api/opportunities/${opp.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId: target.id }),
      })
      const putData = await resPut.json().catch(() => ({}))
      log('B2d', 'PUT etapa → CRM dispara bridge stage-change (fire-and-forget)', resPut.status === 200, `status=${resPut.status} stage=${putData?.opportunity?.stage?.name ?? target.name}`)

      // Verificar log del bridge en el servidor CRM (evidencia de entrega)
      await new Promise(r => setTimeout(r, 1500))
      const { execSync } = await import('node:child_process')
      let bridgeLog = ''
      try { bridgeLog = execSync("grep 'whatspower-bridge' /home/z/my-project/dev.log 2>/dev/null | tail -3 || true").toString() } catch {}
      log('B2e', 'Evidencia en log del CRM: stage-change entregado a WHATSPOWER', bridgeLog.includes('stage-change entregado'), bridgeLog.trim().split('\n').slice(-1)[0] || '(sin log)')
    }

    // B3: contrato directo del receptor stage-change de WHATSPOWER (misma shape)
    const stagePayload = {
      clientId: client.id,
      clientPhone: PHONE,
      clientName: client.name,
      opportunityId: opp?.id || 'opp_e2e',
      fromStage: 'NUEVO',
      toStage: 'PROPUESTA_ENVIADA',
      dealValue: 1200,
    }
    const resStage = await fetch(`${WP}/api/crm/stage-change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stagePayload) })
    const stageOut = await resStage.json().catch(() => ({}))
    log('B3', 'Receptor /api/crm/stage-change de WHATSPOWER dispara trigger', resStage.status === 200, `status=${resStage.status} resp=${JSON.stringify(stageOut).slice(0, 120)}`)
  }

  const fails = results.filter(r => !r.pass).length
  console.log(`\n=== PARTE B: ${results.length - fails}/${results.length} PASS ===`)
  process.exit(fails ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
