// E2E post-publicación — PRUEBA B: CRM → WHATSPOWER (webhook firmado, stage-change, fail-open, multi-tenancy)
import { createHmac } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import Database from 'better-sqlite3'

const CRM = 'http://localhost:3000'
const WPDB = '/home/z/repos/WHATSPOWER/db/operational.db'
const { META_SECRET, TOK, WP_SECRET, CRM_KEY, DAEMON_SECRET } = process.env
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync('/home/z/my-project/download/e2e-postpub', { recursive: true })

// B0. Etapa PROPUESTA_ENVIADA (datos demo efímeros) + oportunidad objetivo
{
  const db = new Database('/home/z/my-project/db/custom.db')
  const cols = db.prepare('PRAGMA table_info(PipelineStage)').all().map(c => c.name)
  const hasStage = db.prepare("SELECT count(*) c FROM PipelineStage WHERE name='PROPUESTA_ENVIADA'").get().c > 0
  if (!hasStage) {
    const orgId = db.prepare('SELECT organizationId FROM Opportunity LIMIT 1').get().organizationId
    const id = 'stg_e2e_propuesta_' + Date.now().toString(36)
    const rec = { id, organizationId: orgId, name: 'PROPUESTA_ENVIADA' }
    for (const c of cols) if (!(c in rec)) rec[c] = c === 'probability' ? 0.5 : c === 'order' ? 99 : c === 'color' ? '#10b981' : c === 'isWon' || c === 'isLost' ? 0 : null
    const keys = Object.keys(rec).filter(k => cols.includes(k))
    db.prepare(`INSERT INTO PipelineStage (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => rec[k]))
  }
  db.close()
}
const crmDb = new Database('/home/z/my-project/db/custom.db', { readonly: true })
const stage = crmDb.prepare("SELECT id FROM PipelineStage WHERE name='PROPUESTA_ENVIADA'").get()
const opp = crmDb.prepare('SELECT id, clientId, stageId FROM Opportunity ORDER BY createdAt LIMIT 1').get()
line(`B0 etapa PROPUESTA_ENVIADA=${!!stage} | oportunidad=${opp ? opp.id.slice(0, 8) + '…' : 'NO'}`)

// B1. Webhook Meta firmado → CRM procesa → bridge reenvía a WHATSPOWER
const msgFrom = '573000000201'
const mkPayload = (wamid) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'e2e-entry', changes: [{ field: 'messages', value: {
    metadata: { display_phone_number: '573001234567', phone_number_id: 'e2e-phone-id-2026' },
    contacts: [{ wa_id: msgFrom, profile: { name: 'E2E PostPub B' } }],
    messages: [{ from: msgFrom, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hola desde E2E-WHATSPOWER-CRM-2026 (post-publicación)' } }],
  } } ] } ],
})
const payload1 = mkPayload('wamid.E2EPOSTPUB.' + Date.now())
const sig1 = 'sha256=' + createHmac('sha256', META_SECRET).update(payload1).digest('hex')
const w1 = await fetch(`${CRM}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig1 }, body: payload1 })
line(`B1 webhook Meta firmado: HTTP ${w1.status} PASS=${w1.status === 200}`)

// B2. Persistencia en WHATSPOWER (inbound reenviado por el bridge)
await new Promise(r => setTimeout(r, 800))
const wp = new Database(WPDB, { readonly: true })
const inb = wp.prepare("SELECT count(*) c FROM inbox_messages WHERE contact_phone=? AND direction='inbound'").get(msgFrom).c
line(`B2 WHATSPOWER inbox inbound del reenvío: ${inb} fila(s) PASS=${inb > 0}`)

// B3. Log del CRM confirma entrega del bridge
await new Promise(r => setTimeout(r, 300))
let bridgeLog = ''
try { bridgeLog = execSync("rg -N 'whatspower-bridge' /home/z/my-project/dev.log | tail -2").toString().trim() } catch {}
line(`B3 log bridge CRM: ${bridgeLog ? bridgeLog.split('\n').length + ' línea(s): ' + bridgeLog.split('\n')[0].slice(0, 110) : 'SIN LÍNEAS'}`)

// B4. Cambio de etapa → trigger en WHATSPOWER (mensaje outbound persistido, sin envío real)
const p4 = await fetch(`${CRM}/api/opportunities/${opp.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK}` }, body: JSON.stringify({ stageId: stage.id }) })
line(`B4 PUT etapa oportunidad: HTTP ${p4.status}`)
await new Promise(r => setTimeout(r, 900))
const outb = wp.prepare("SELECT contact_phone, text FROM inbox_messages WHERE direction='outbound' AND text LIKE '%propuesta%' ORDER BY created_at DESC LIMIT 1").get()
line(`B4 trigger WHATSPOWER (outbound a cliente de la oportunidad ${outb ? outb.contact_phone : 'NO'}): ${outb ? `"${outb.text.slice(0, 55)}"` : 'NO'} PASS=${!!outb && outb.text.includes('propuesta')}`)
wp.close()

// B5. Fail-open del bridge: WHATSPOWER caído NO rompe el CRM
const pidWp = execSync("ss -tlnp | rg ':3003' | rg -o 'pid=[0-9]+' | head -1").toString().replace('pid=', '').trim()
process.kill(Number(pidWp))
await new Promise(r => setTimeout(r, 600))
const payload2 = mkPayload('wamid.E2EPOSTPUB.DOWN.' + Date.now())
const sig2 = 'sha256=' + createHmac('sha256', META_SECRET).update(payload2).digest('hex')
const w2 = await fetch(`${CRM}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig2 }, body: payload2 })
line(`B5 WHATSPOWER caído → CRM webhook: HTTP ${w2.status} PASS=${w2.status === 200} (fire-and-forget, sin 500)`)

// reiniciar WHATSPOWER con las mismas credenciales
const wpChild = spawn('node', ['--experimental-strip-types', 'src/server.ts'], {
  cwd: '/home/z/repos/WHATSPOWER', detached: true, stdio: 'ignore',
  env: { ...process.env, PORT: '3003', CRM_BASE_URL: 'http://localhost:3000', CRM_API_KEY: CRM_KEY, AGENTIC_2A_WEBHOOK_SECRET: WP_SECRET },
})
wpChild.unref()
let wpUp = false
for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 700)); try { const h = await fetch('http://localhost:3003/api/health'); if (h.ok) { wpUp = true; break } } catch {} }
line(`B5' WHATSPOWER reiniciado: ${wpUp}`)

// B6. Multi-tenancy: segunda organización REAL (BD) con API key propia no puede tocar clientes de la primera
const { createHash, randomBytes } = await import('node:crypto')
{
  const wdb = new Database('/home/z/my-project/db/custom.db')
  const orgB = 'org_e2e_b_' + randomBytes(4).toString('hex')
  const now = new Date().toISOString()
  wdb.prepare('INSERT INTO Organization (id, name, slug, plan, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?)').run(orgB, 'Org B E2E', 'org-b-e2e', 'free', now, now)
  const raw2 = `albra_${randomBytes(24).toString('hex')}`
  wdb.prepare('INSERT INTO ApiKey (id, organizationId, name, hashedKey, prefix, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run('key_e2e_b_' + randomBytes(4).toString('hex'), orgB, 'orgB-key', createHash('sha256').update(raw2).digest('hex'), raw2.slice(0, 11), now)
  wdb.close()
  var KEY2 = raw2
}
const cross = await (await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY2}` }, body: JSON.stringify({ action: 'add_note', params: { clientId: opp.clientId, content: 'intruso' } }) })).json()
line(`B6 cross-org (org B real) add_note sobre cliente de org A: ok=${cross.ok} summary="${String(cross.summary || cross.error || '').slice(0, 60)}" PASS=${cross.ok === false}`)

// B7. Batería auth CRM
const noAuth = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"add_note"}' })
const badKey = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer albra_validformatbutwrong0000' }, body: '{"action":"add_note"}' })
const unknown = await fetch(`${CRM}/api/crm/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRM_KEY}` }, body: '{"action":"no_existe","params":{}}' })
line(`B7 CRM sin auth: ${noAuth.status} PASS=${noAuth.status === 401} | key inválida: ${badKey.status} PASS=${badKey.status === 401} | acción desconocida: ${unknown.status} PASS=${unknown.status === 400}`)
crmDb.close()

writeFileSync('/home/z/my-project/download/e2e-postpub/B-crm-whatspower.txt', EVID.join('\n') + '\n')
console.log('EVIDENCIA B guardada')
