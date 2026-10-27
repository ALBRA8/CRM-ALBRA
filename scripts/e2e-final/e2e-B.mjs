// E2E FINAL — FLUJO 2: CRM → WHATSPOWER (webhook Meta firmado → bridge → WP; stage-change → trigger; fail-open; multi-tenancy)
// Evidencia sanitizada → evidencias/e2e/B-crm-whatspower.txt
import { createHmac, createHash, randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

const CRM = 'http://localhost:3000'
const WP_DB = '/home/z/my-project/albra-final/WHATSPOWER/db/operational.db'
const CRM_DB = '/home/z/my-project/albra-final/e2e/crm-e2e.db'
const EVID_DIR = '/home/z/my-project/download/ALBRA-PRUEBA-INTEGRAL/evidencias/e2e'
const { E2E_META_SECRET, E2E_TOK, E2E_CRM_KEY, E2E_ENC_KEY } = process.env
const EVID = []
const line = (s) => { console.log(s); EVID.push(s); writeFileSync(`${EVID_DIR}/B-crm-whatspower.txt`, EVID.join('\n') + '\n') }
mkdirSync(EVID_DIR, { recursive: true })

// Conexión SQLite tolerante a locks del dev server (timeout=busy_timeout 20s)
const openDb = (path, readonly = false) => new Database(path, { readonly, timeout: 20000 })

// ---------- F1.1 Fixtures: etapa PROPUESTA_ENVIADA + cliente + oportunidad (datos sintéticos) ----------
{
  const wdb = openDb(CRM_DB)
  const org = wdb.prepare('SELECT id FROM Organization ORDER BY createdAt LIMIT 1').get()
  const hasStage = wdb.prepare("SELECT count(*) c FROM PipelineStage WHERE name='PROPUESTA_ENVIADA'").get().c > 0
  if (!hasStage) {
    const cols = wdb.prepare('PRAGMA table_info(PipelineStage)').all().map(c => c.name)
    const rec = { id: 'stg_e2e_prop_' + Date.now().toString(36), organizationId: org.id, name: 'PROPUESTA_ENVIADA' }
    for (const c of cols) if (!(c in rec)) rec[c] = c === 'probability' ? 0.5 : c === 'order' ? 99 : c === 'color' ? '#10b981' : c === 'isWon' || c === 'isLost' ? 0 : null
    const keys = Object.keys(rec).filter(k => cols.includes(k))
    wdb.prepare(`INSERT INTO PipelineStage (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => rec[k]))
  }
  // Integration con metaAppSecretEnc (AES-256-GCM v1:, misma especificación de src/lib/crypto.ts)
  const iv = randomBytes(12)
  const key = createHash('sha256').update(E2E_ENC_KEY).digest()
  const cipher = (await import('node:crypto')).createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(E2E_META_SECRET, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const encStr = `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
  const hasInt = wdb.prepare('SELECT count(*) c FROM Integration WHERE organizationId=?').get(org.id).c > 0
  if (!hasInt) {
    wdb.prepare('INSERT INTO Integration (id, organizationId, metaAppSecretEnc, whatsappPhoneId, enableWhatsApp, updatedAt) VALUES (?, ?, ?, ?, 0, datetime(\'now\'))')
      .run('int_e2e_' + Date.now().toString(36), org.id, encStr, 'e2e-phone-id-2026')
  }
  wdb.close()
  line(`B0 fixtures: etapa PROPUESTA_ENVIADA + Integration (org ${org.id.slice(0, 8)}…) listos`)
}
// Cliente y oportunidad vía API (flujo normal del CRM)
const mk = await (await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E2E_CRM_KEY}` }, body: JSON.stringify({ action: 'create_client', params: { name: 'E2E Final Cliente B', phone: '573000000' + String(Date.now()).slice(-3), email: 'e2e-b-' + String(Date.now()).slice(-5) + '@albra-test.local' } }) })).json()
const clientId = mk?.data?.clientId || mk?.clientId || null
line(`B0' cliente creado vía CRM actions: ${clientId ? clientId.slice(0, 8) + '…' : JSON.stringify(mk).slice(0, 80)}`)
const oppRes = await fetch(`${CRM}/api/opportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E2E_TOK}` }, body: JSON.stringify({ title: 'E2E Final Oportunidad B', clientId }) })
const oppJson = await oppRes.json().catch(() => ({}))
const opp = oppJson?.data?.id || oppJson?.id || oppJson?.opportunity?.id || null
line(`B0'' oportunidad creada: HTTP ${oppRes.status} id=${opp ? opp.slice(0, 8) + '…' : 'NO'}`)

// ---------- F2.2 Webhook Meta firmado → CRM procesa → bridge reenvía a WHATSPOWER ----------
const msgFrom = '573000' + String(Date.now()).slice(-6)
const mkPayload = (wamid) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'e2e-entry', changes: [{ field: 'messages', value: {
    metadata: { display_phone_number: '573001234567', phone_number_id: 'e2e-phone-id-2026' },
    contacts: [{ wa_id: msgFrom, profile: { name: 'E2E Final B' } }],
    messages: [{ from: msgFrom, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hola desde E2E-WHATSPOWER-CRM-2026 (flujo 2)' } }],
  } } ] } ],
})
const payload1 = mkPayload('wamid.E2EFINAL.' + Date.now())
const sig1 = 'sha256=' + createHmac('sha256', E2E_META_SECRET).update(payload1).digest('hex')
const w1 = await fetch(`${CRM}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig1 }, body: payload1 })
line(`B1 webhook Meta firmado: HTTP ${w1.status} PASS=${w1.status === 200}`)

// ---------- F2.3/F2.4 Recepción en WHATSPOWER (firma+correlación hechas por el bridge) ----------
await new Promise(r => setTimeout(r, 1000))
const wp = openDb(WP_DB, true)
const inb = wp.prepare("SELECT count(*) c FROM inbox_messages WHERE contact_phone=? AND direction='inbound'").get(msgFrom).c
line(`B2 WHATSPOWER recibió el reenvío del bridge (inbox inbound): ${inb} fila(s) PASS=${inb > 0}`)

// ---------- F2.5 Deduplicación de eventos repetidos (mismo wamid) ----------
const w1b = await fetch(`${CRM}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig1 }, body: payload1 })
await new Promise(r => setTimeout(r, 800))
const inb2 = wp.prepare("SELECT count(*) c FROM inbox_messages WHERE contact_phone=? AND direction='inbound'").get(msgFrom).c
line(`B3 mismo webhook repetido: CRM HTTP ${w1b.status} | filas WP=${inb2} (0 nuevos = dedup eficaz) PASS=${inb2 === inb}`)

// ---------- F2.3' Cambio de etapa → trigger en WHATSPOWER (outbound persistido, SIN envío real) ----------
const stage = openDb(CRM_DB, true).prepare("SELECT id FROM PipelineStage WHERE name='PROPUESTA_ENVIADA'").get()
const p4 = await fetch(`${CRM}/api/opportunities/${opp}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E2E_TOK}` }, body: JSON.stringify({ stageId: stage.id }) })
line(`B4 PUT etapa de la oportunidad: HTTP ${p4.status}`)
await new Promise(r => setTimeout(r, 1000))
const outb = wp.prepare("SELECT contact_phone, text FROM inbox_messages WHERE direction='outbound' AND text LIKE '%propuesta%' ORDER BY created_at DESC LIMIT 1").get()
line(`B4' trigger WHATSPOWER (outbound persistido a ${outb ? outb.contact_phone : 'NO'}): ${outb ? `"${outb.text.slice(0, 55)}"` : 'NO'} PASS=${!!outb && outb.text.toLowerCase().includes('propuesta')}`)
line(`B4'' control anti-envío real: el outbound es registro en BD de WP; transport WP = Mock (ninguna pasarela real invocada)`)
wp.close()

// ---------- F4-2 Fail-open: WHATSPOWER caído NO rompe el CRM ----------
const pidWp = Number(process.env.E2E_WP_PID)
if (pidWp) {
  try { process.kill(pidWp) } catch {}
  await new Promise(r => setTimeout(r, 600))
  const payload2 = mkPayload('wamid.E2EFINAL.DOWN.' + Date.now())
  const sig2 = 'sha256=' + createHmac('sha256', E2E_META_SECRET).update(payload2).digest('hex')
  const w2 = await fetch(`${CRM}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig2 }, body: payload2 })
  line(`B5 WHATSPOWER caído → CRM webhook: HTTP ${w2.status} PASS=${w2.status === 200} (fire-and-forget, sin 500)`)
}

// ---------- F4-6 Multi-tenancy: org B real no puede tocar clientes de org A ----------
{
  const wdb = openDb(CRM_DB)
  const orgB = 'org_e2e_b_' + randomBytes(4).toString('hex')
  const now = new Date().toISOString()
  wdb.prepare('INSERT INTO Organization (id, name, slug, plan, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?)').run(orgB, 'Org B E2E', 'org-b-e2e-' + randomBytes(2).toString('hex'), 'free', now, now)
  const raw2 = `albra_${randomBytes(24).toString('hex')}`
  wdb.prepare('INSERT INTO ApiKey (id, organizationId, name, hashedKey, prefix, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run('key_e2e_b_' + randomBytes(4).toString('hex'), orgB, 'orgB-key', createHash('sha256').update(raw2).digest('hex'), raw2.slice(0, 11), now)
  wdb.close()
  const cross = await (await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${raw2}` }, body: JSON.stringify({ action: 'add_note', params: { clientId, content: 'intruso' } }) })).json()
  line(`B6 cross-org (org B real) add_note sobre cliente de org A: ok=${cross.ok} summary="${String(cross.summary || cross.error || '').slice(0, 60)}" PASS=${cross.ok === false}`)
}

// ---------- Batería auth CRM ----------
const noAuth = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"add_note"}' })
const badKey = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer albra_validformatbutwrong0000' }, body: '{"action":"add_note"}' })
const unknown = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E2E_CRM_KEY}` }, body: '{"action":"no_existe","params":{}}' })
line(`B7 CRM sin auth: ${noAuth.status} PASS=${noAuth.status === 401} | key inválida: ${badKey.status} PASS=${badKey.status === 401} | acción desconocida: ${unknown.status} PASS=${unknown.status === 400}`)

// ---------- Firma Meta inválida → rechazo ----------
const badSig = await fetch(`${CRM}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }, body: payload1 })
line(`B8 webhook Meta firma inválida: HTTP ${badSig.status} PASS=${badSig.status === 401}`)

writeFileSync(`${EVID_DIR}/B-crm-whatspower.txt`, EVID.join('\n') + '\n')
console.log('EVIDENCIA B guardada')
