// E2E FINAL — FLUJO 3: WHATSPOWER-ULTRA → servicio de despacho (guard, auth, dedup, anti-ban, sin falso éxito)
// Evidencia sanitizada → evidencias/e2e/C-ultra-daemon.txt
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'

const { E2E_INT_SECRET } = process.env
const EVID_DIR = '/home/z/my-project/download/ALBRA-PRUEBA-INTEGRAL/evidencias/e2e'
const E2E = '/home/z/my-project/albra-final/e2e'
const ULTRA = '/home/z/my-project/albra-final/WHATSPOWER-ULTRA'
const STUB_LOG = `${E2E}/stub-dispatches.jsonl`
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync(EVID_DIR, { recursive: true })

// ---------- F3.1/F3.3 Guard físico: despacho al daemon REAL (:3002) bloqueado sin autorización explícita ----------
process.env.INTERNAL_API_SECRET = E2E_INT_SECRET
process.env.WHATSAPP_DAEMON_URL = 'http://localhost:3002'
const { HttpCrmDaemonDispatcher } = await import(`${ULTRA}/src/adapters/dispatcher.ts`)
const guard = new HttpCrmDaemonDispatcher({ endpointUrl: 'http://localhost:3002/send', secret: E2E_INT_SECRET, allowRealDispatch: false })
const gRes = await guard.dispatch('573009990011', 'prueba guard')
line(`C1 guard físico contra daemon real: ${String(gRes.error || gRes.success).slice(0, 70)} PASS=${gRes.success === false && String(gRes.error).includes('DISPATCH_BLOCKED_BY_SAFETY_GUARD')}`)

// ---------- F4-4 Daemon real :3002 — credenciales y estado (sin sesión WhatsApp → sin envío posible) ----------
const badAuth = await fetch('http://localhost:3002/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer clave_incorrecta' }, body: JSON.stringify({ to: '573009990011', text: 'x' }) })
const goodAuth = await fetch('http://localhost:3002/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${E2E_INT_SECRET}` }, body: JSON.stringify({ to: '573009990011', text: 'x' }) })
const goodBody = await goodAuth.json().catch(() => ({}))
line(`C2 daemon real: Bearer inválido=${badAuth.status} PASS=${badAuth.status === 401} | Bearer válido=${goodAuth.status} (${String(goodBody.error || 'ok').slice(0, 40)}) PASS=${goodAuth.status === 400 && String(goodBody.error || '').includes('no conectado')}`)

// ---------- F3.2/F3.4 Campaña ULTRA → stub fiel (:3012): auth Bearer + dedup + persistencia ----------
existsSync(STUB_LOG) && rmSync(STUB_LOG)
const stub = spawn('node', [`${E2E}/stub-daemon.mjs`], { detached: true, stdio: 'ignore', env: { ...process.env, STUB_SECRET: E2E_INT_SECRET, STUB_LOG } })
stub.unref()
await new Promise(r => setTimeout(r, 800))
process.env.WHATSAPP_DAEMON_URL = 'http://localhost:3012'
const { createBroadcastServer } = await import(`${ULTRA}/src/server.ts`)
const srv = createBroadcastServer({ dbPath: ':memory:' })
const engine = srv.engine
const camp = await engine.createCampaign({
  organizationId: 'org_e2e_ultra_final',
  name: 'E2E Final C',
  templateSpintax: '{Hola|Buen día} {{nombre}}, mensaje de prueba E2E-WHATSPOWER-CRM-2026',
  csvContent: 'phone,name\n573003112233,Uno\n573003112233,UnoDuplicado\n573004422311,Dos',
})
line(`C3 campaña creada: targets=${camp.totalTargets} (dedup 3→${camp.totalTargets}) PASS=${camp.totalTargets === 2}`)
const businessDate = new Date('2026-10-27T10:00:00-05:00') // 10:00 Bogotá — dentro de horario
const s1 = await engine.processNextItem(camp.id, businessDate)
const s2 = await engine.processNextItem(camp.id, businessDate)
const s3 = await engine.processNextItem(camp.id, businessDate)
line(`C3' procesamiento: ${s1.status}, ${s2.status}, ${s3.status} PASS=${s1.status === 'SENT' && s2.status === 'SENT' && s3.status === 'COMPLETED'}`)
await new Promise(r => setTimeout(r, 400))
const dispatches = existsSync(STUB_LOG) ? readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean) : []
const uniqueTo = new Set(dispatches.map(d => JSON.parse(d).to))
line(`C3'' despachos recibidos por el stub: ${dispatches.length} | teléfonos únicos: ${uniqueTo.size} PASS=${dispatches.length === 2 && uniqueTo.size === 2}`)

// ---------- F4-5 Ejecución repetida: ítems ya SENT no se re-despachan ----------
const again = await engine.processNextItem(camp.id, businessDate)
line(`C3''' repetición sobre campaña completada: ${again.status} (sin nuevos despachos)`)
const dispatchesAfter = existsSync(STUB_LOG) ? readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0
line(`C3'''' despachos totales tras repetición: ${dispatchesAfter} PASS=${dispatchesAfter === 2}`)

// ---------- F3.6/F3.7 Anti-ban horario: fuera de ventana → PAUSED_OFF_HOURS (0 envíos) ----------
const campN = await engine.createCampaign({
  organizationId: 'org_e2e_ultra_final',
  name: 'E2E Final C nocturna',
  templateSpintax: 'Hola {{nombre}}',
  csvContent: 'phone,name\n573005554433,Noche',
})
const nightDate = new Date('2026-10-27T03:00:00-05:00') // 03:00 Bogotá
const n1 = await engine.processNextItem(campN.id, nightDate)
line(`C4 anti-ban nocturno (03:00 Bogotá): ${n1.status} PASS=${n1.status === 'PAUSED_OFF_HOURS'}`)

// ---------- F4-7 Timeout tras aceptar → NUNCA falso éxito (stub lento) ----------
// primero liberar el puerto (matar stub rápido), luego arrancar el lento
execSync("ss -tlnp | grep ':3012 ' | grep -oP 'pid=\\K[0-9]+' | head -1 | xargs -r kill", { shell: '/bin/bash' })
await new Promise(r => setTimeout(r, 700))
const stubSlow = spawn('node', [`${E2E}/stub-daemon.mjs`], { detached: true, stdio: 'ignore', env: { ...process.env, STUB_SECRET: E2E_INT_SECRET, STUB_LOG: STUB_LOG + '.slow', STUB_MODE: 'slow' } })
stubSlow.unref()
await new Promise(r => setTimeout(r, 900))
const slowSrv = createBroadcastServer({ dbPath: ':memory:' })
const slowCamp = await slowSrv.engine.createCampaign({
  organizationId: 'org_e2e_ultra_final', name: 'E2E Final C timeout', templateSpintax: 'Hola {{nombre}}',
  csvContent: 'phone,name\n573006667788,Timeout',
})
const t0 = Date.now()
const tRes = await slowSrv.engine.processNextItem(slowCamp.id, businessDate)
const dt = Date.now() - t0
line(`C5 timeout (stub >5s): status=${tRes.status} error="${String(tRes.error || '').slice(0, 55)}" (${dt}ms) PASS=${tRes.status === 'UNCERTAIN_DISPATCH' && String(tRes.error).includes('UNCERTAIN')}`)
execSync("ss -tlnp | grep ':3012 ' | grep -oP 'pid=\\K[0-9]+' | head -1 | xargs -r kill", { shell: '/bin/bash' })
await new Promise(r => setTimeout(r, 500))

// ---------- F4-7b Respuesta malformada (HTTP 200 no-JSON) → uncertain, no falso éxito ----------
const stubMal = spawn('node', [`${E2E}/stub-daemon.mjs`], { detached: true, stdio: 'ignore', env: { ...process.env, STUB_SECRET: E2E_INT_SECRET, STUB_LOG: STUB_LOG + '.mal', STUB_MODE: 'malformed' } })
stubMal.unref()
await new Promise(r => setTimeout(r, 900))
const malSrv = createBroadcastServer({ dbPath: ':memory:' })
const malCamp = await malSrv.engine.createCampaign({
  organizationId: 'org_e2e_ultra_final', name: 'E2E Final C malformado', templateSpintax: 'Hola {{nombre}}',
  csvContent: 'phone,name\n573007778899,Malformado',
})
const mRes = await malSrv.engine.processNextItem(malCamp.id, businessDate)
line(`C5' HTTP 200 malformado: status=${mRes.status} error="${String(mRes.error || '').slice(0, 55)}" PASS=${mRes.status === 'UNCERTAIN_DISPATCH' && String(mRes.error).includes('MALFORMED')}`)
execSync("ss -tlnp | grep ':3012 ' | grep -oP 'pid=\\K[0-9]+' | head -1 | xargs -r kill", { shell: '/bin/bash' })
await new Promise(r => setTimeout(r, 500))

// ---------- F3.5 Ingesta de leads en server vivo :3004 ----------
const okLead = await (await fetch('http://localhost:3004/api/audiences/webhook-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '573005556667', name: 'Lead Live E2E', source: 'e2e-final' }) })).json()
const badLead = await (await fetch('http://localhost:3004/api/audiences/webhook-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'telefono-malo', name: 'X' }) })).json()
line(`C6 ingesta lead válido: success=${okLead.success} PASS=${okLead.success === true} | teléfono inválido: ${badLead.reason} PASS=${badLead.reason === 'INVALID_PHONE_FORMAT'}`)
let persisted = 0
try {
  const Database = (await import('better-sqlite3')).default
  const udb = new Database(`${ULTRA}/db/broadcast.db`, { readonly: true })
  persisted = udb.prepare("SELECT count(*) c FROM realtime_leads WHERE phone LIKE '%573005556667%'").get().c
  udb.close()
} catch (e) { line(`C6' (aviso lectura BD ULTRA: ${String(e).slice(0, 60)})`) }
line(`C6'' lead persistido en BD de ULTRA: ${persisted} fila(s) PASS=${persisted >= 1}`)

writeFileSync(`${EVID_DIR}/C-ultra-daemon.txt`, EVID.join('\n') + '\n')
console.log('EVIDENCIA C guardada')
