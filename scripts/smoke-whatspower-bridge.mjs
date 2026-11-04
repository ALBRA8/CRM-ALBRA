/**
 * Smoke E2E del puente CRM-ALBRA ↔ WHATSPOWER (Nivel 2).
 *
 * Prueba las 3 patas del contrato con las rutas REALES del producto:
 *   T1  CRM→WP inbound      : webhook Meta firmado → CRM valida → puente firma
 *                             HMAC → WP /api/inbound procesa.
 *   T2  WP→CRM actions      : WP (con CRM_API_KEY albra_…) ejecuta
 *                             create_client contra POST /api/crm/actions.
 *                             (Se dispara solo: el lead nuevo del T1 llega a WP
 *                             sin clientId → WP lo registra en el CRM.)
 *                             Extra: llamada directa réplica de HttpCrmClient.
 *   T3  CRM→WP stage-change : PUT /api/opportunities/:id cambia etapa →
 *                             WP /api/crm/stage-change recibe el trigger.
 *
 * Uso: node scripts/smoke-whatspower-bridge.mjs
 * Requisitos: CRM arriba en :3000 (WHATSPOWER_ENABLED=true + WHATSPOWER_WEBHOOK_SECRET
 * en .env) y WHATSPOWER arriba en :3003 (AGENTIC_2A_WEBHOOK_SECRET igual + CRM_API_KEY).
 * Los secrets se leen de los .env; NUNCA se imprimen.
 */
import { createHmac, randomBytes } from 'crypto'
import { readFileSync, appendFileSync } from 'fs'

const CRM = 'http://localhost:3000'
const WP = 'http://localhost:3003'
const CRM_ENV = '/home/z/my-project/.env'
const WP_ENV = '/home/z/my-project/repos/WHATSPOWER/.env'
const CRM_LOG = '/home/z/my-project/dev.log'
const WP_LOG = '/home/z/my-project/repos/WHATSPOWER/server.log'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readEnvKey(file, key) {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(key + '='))
  if (!line) throw new Error(`${key} no encontrado en ${file}`)
  return line.slice(key.length + 1).trim()
}

async function main() {
  // ── Setup: login demo + config WhatsApp de la org (appSecret sandbox) ──
  const loginRes = await fetch(`${CRM}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@crmalbra.com', password: 'AlbraDemo2026' }),
  })
  const login = await loginRes.json()
  const jwt = login.token || login.accessToken
  check('setup: login demo', Boolean(jwt))
  const auth = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }

  const appSecret = 'smoke-app-secret-' + randomBytes(12).toString('hex')
  const phoneId = 'smoke-phone-id-' + randomBytes(4).toString('hex')
  const cfgRes = await fetch(`${CRM}/api/whatsapp/config`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ whatsappPhoneId: phoneId, metaAppSecret: appSecret, enableWhatsApp: true }),
  })
  check('setup: config WhatsApp org (appSecret+phoneId)', cfgRes.ok, cfgRes.ok ? '' : `HTTP ${cfgRes.status}`)

  // ── T1: webhook Meta firmado → CRM → puente → WP ──
  // Texto neutro (sin keywords de flujo/reglas de WP) para que el router de WP
  // caiga en el Caso C (new_lead_welcome) y ejecute create_client de vuelta al CRM.
  const leadPhone = '57300' + String(1000000 + Math.floor(Math.random() * 8999999))
  const waBody = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'smoke-entry',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '573000000000', phone_number_id: phoneId },
          contacts: [{ wa_id: leadPhone, profile: { name: 'Lead Smoke Puente' } }],
          messages: [{
            from: leadPhone,
            id: 'wamid.smoke.' + randomBytes(6).toString('hex'),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: 'buenas tardes consulta directa numero 4721' },
          }],
        },
      }],
    }],
  })
  const metaSig = 'sha256=' + createHmac('sha256', appSecret).update(waBody, 'utf8').digest('hex')
  const hookRes = await fetch(`${CRM}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': metaSig },
    body: waBody,
  })
  check('T1: webhook Meta firmado aceptado por CRM', hookRes.ok, hookRes.ok ? '' : `HTTP ${hookRes.status}: ${(await hookRes.text()).slice(0, 120)}`)
  await sleep(3500) // margen para puente (3s timeout) + router WP + acción WP→CRM

  const crmLog = readFileSync(CRM_LOG, 'utf8')
  check('T1: CRM registró entrega del puente a WP', crmLog.includes('[whatspower-bridge] inbound entregado a WHATSPOWER'))

  // ── T2: WP procesó el inbound y creó el cliente en el CRM vía /api/crm/actions ──
  // WP no loguea inbound: la prueba efectiva es que exista un cliente con el teléfono
  // del lead y source 'crm-api' (creado por HttpCrmClient de WP con la albra_ key).
  const clientsRes = await fetch(`${CRM}/api/clients?q=${leadPhone}`, { headers: { Authorization: `Bearer ${jwt}` } })
  const clientsBody = await clientsRes.json()
  const all = (Array.isArray(clientsBody) ? clientsBody : clientsBody.clients || []).filter(
    (c) => String(c.phone || '').includes(leadPhone.slice(-8)),
  )
  const viaWp = all.filter((c) => c.source === 'crm-api')
  check('T2: cliente del lead visible en CRM (webhook)', all.length >= 1, all.length ? `${all.length} cliente(s)` : 'no apareció')
  check('T2: WP sincronizó create_client vía albra_ key (source crm-api)', viaWp.length >= 1, viaWp.length ? `clientId ${viaWp[0].id}` : 'WP no llamó al CRM')
  const found = all

  // T2-extra: réplica directa de HttpCrmClient (misma petición que envía WP)
  const apiKey = readEnvKey(WP_ENV, 'CRM_API_KEY')
  const directRes = await fetch(`${CRM}/api/crm/actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Correlation-Id': 'smoke-' + randomBytes(4).toString('hex'),
    },
    body: JSON.stringify({ action: 'create_client', params: { name: 'Cliente Vía WP Directo', phone: '573009998877' } }),
  })
  const direct = await directRes.json()
  check('T2-extra: create_client directo con albra_ key', directRes.ok && direct.ok !== false, `HTTP ${directRes.status} ${direct.summary || direct.error || ''}`)

  // ── T3: stage-change CRM → WP ──
  const mark = crmLog.length // offset de log para detectar líneas NUEVAS del puente
  const stagesRes = await fetch(`${CRM}/api/pipeline`, { headers: { Authorization: `Bearer ${jwt}` } })
  const stages = (await stagesRes.json()).stages || []
  const stageA = stages[0]
  const stageB = stages[1]
  check('setup: pipeline semilla con ≥2 etapas', Boolean(stageA && stageB))

  const oppRes = await fetch(`${CRM}/api/opportunities`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Smoke Puente CRM↔WP', clientId: found[0]?.id, stageId: stageA.id, amount: 1500000 }),
  })
  const oppBody = await oppRes.json()
  const opp = oppBody.opportunity || oppBody
  check('setup: oportunidad creada en etapa A', oppRes.ok && opp.id, oppRes.ok ? `id ${opp.id}` : `HTTP ${oppRes.status}: ${JSON.stringify(oppBody).slice(0, 150)}`)

  const putRes = await fetch(`${CRM}/api/opportunities/${opp.id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ stageId: stageB.id }),
  })
  check('T3: cambio de etapa ejecutado', putRes.ok, putRes.ok ? '' : `HTTP ${putRes.status}`)
  await sleep(2500)
  const crmLog2 = readFileSync(CRM_LOG, 'utf8').slice(mark)
  check('T3: CRM entregó stage-change a WP', crmLog2.includes('stage-change entregado a WHATSPOWER'), crmLog2.includes('stage-change') ? crmLog2.match(/stage-change[^\n]*/)?.[0]?.slice(0, 110) : '')

  // ── Resumen ──
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks OK`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e.message)
  process.exit(1)
})
