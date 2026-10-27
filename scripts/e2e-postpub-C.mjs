// E2E post-publicación — PRUEBA C: WHATSPOWER-ULTRA → daemon del CRM (guard, auth, persistencia, anti-ban) SIN envíos reales
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const { DAEMON_SECRET } = process.env
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync('/home/z/my-project/download/e2e-postpub', { recursive: true })
const STUB_LOG = '/home/z/my-project/download/e2e-postpub/stub-dispatches.jsonl'

// C0. Stub en :3012 con la nueva versión (registro en fichero)
try { const pid = execSync("ss -tlnp | rg ':3012' | rg -o 'pid=[0-9]+' | head -1").toString().replace('pid=', '').trim(); if (pid) process.kill(Number(pid)) } catch {}
await new Promise(r => setTimeout(r, 500))
existsSync(STUB_LOG) && rmSync(STUB_LOG)
const { spawn } = await import('node:child_process')
const stub = spawn('node', ['scripts/stub-daemon.mjs'], { cwd: '/home/z/my-project', detached: true, stdio: 'ignore', env: { ...process.env, STUB_SECRET: DAEMON_SECRET } })
stub.unref()
await new Promise(r => setTimeout(r, 800))

// C1. Guard físico: despacho al daemon REAL (:3002) bloqueado sin autorización explícita
process.env.INTERNAL_API_SECRET = DAEMON_SECRET
process.env.WHATSAPP_DAEMON_URL = 'http://localhost:3002'
const { HttpCrmDaemonDispatcher } = await import('/home/z/repos/WHATSPOWER-ULTRA/src/adapters/dispatcher.ts')
const guard = new HttpCrmDaemonDispatcher({ endpointUrl: 'http://localhost:3002/send', secret: DAEMON_SECRET, allowRealDispatch: false })
const gRes = await guard.dispatch('573009990011', 'prueba guard')
line(`C1 guard físico contra daemon real: ${String(gRes.error || gRes.success).slice(0, 70)} PASS=${gRes.success === false && String(gRes.error).includes('DISPATCH_BLOCKED_BY_SAFETY_GUARD')}`)

// C2. Daemon real :3002 — autenticación y estado sin sesión conectada (sin envío posible)
// El daemon carga el .env del proyecto: el secret válido se lee del .env en runtime (nunca se imprime).
const envLine = readFileSync('/home/z/my-project/.env', 'utf8').split('\n').find(l => l.startsWith('INTERNAL_API_SECRET='))
const REAL_DAEMON_SECRET = envLine ? envLine.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : DAEMON_SECRET
const badAuth = await fetch('http://localhost:3002/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer clave_incorrecta' }, body: JSON.stringify({ to: '573009990011', text: 'x' }) })
const goodAuth = await fetch('http://localhost:3002/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REAL_DAEMON_SECRET}` }, body: JSON.stringify({ to: '573009990011', text: 'x' }) })
const goodBody = await goodAuth.json().catch(() => ({}))
line(`C2 daemon real: Bearer inválido=${badAuth.status} PASS=${badAuth.status === 401} | Bearer válido=${goodAuth.status} (${String(goodBody.error || 'ok').slice(0, 40)}) PASS=${goodAuth.status === 400 && String(goodBody.error || '').includes('no conectado')}`)

// C3. Campaña completa ULTRA → stub fiel del daemon (:3012): auth Bearer + persistencia de despachos
process.env.WHATSAPP_DAEMON_URL = 'http://localhost:3012'
const { createBroadcastServer } = await import('/home/z/repos/WHATSPOWER-ULTRA/src/server.ts')
const srv = createBroadcastServer({ dbPath: ':memory:', whatsPowerEnabled: false })
const engine = srv.engine
const camp = await engine.createCampaign({
  organizationId: 'org_e2e_ultra_postpub',
  name: 'E2E PostPub C',
  templateSpintax: '{Hola|Buen día} {{nombre}}, mensaje de prueba E2E-WHATSPOWER-CRM-2026',
  csvContent: 'phone,name\n573003112233,Uno\n573003112233,UnoDuplicado\n573004422311,Dos',
})
line(`C3 campaña creada: targets=${camp.totalTargets} (dedup 3→${camp.totalTargets}) PASS=${camp.totalTargets === 2}`)
const businessDate = new Date('2026-10-27T10:00:00-05:00') // 10:00 Bogotá, dentro de horario
const s1 = await engine.processNextItem(camp.id, businessDate)
const s2 = await engine.processNextItem(camp.id, businessDate)
const s3 = await engine.processNextItem(camp.id, businessDate)
line(`C3 procesamiento: ${s1.status}, ${s2.status}, ${s3.status} PASS=${s1.status === 'SENT' && s2.status === 'SENT' && s3.status === 'COMPLETED'}`)
await new Promise(r => setTimeout(r, 400))
const dispatches = existsSync(STUB_LOG) ? readFileSync(STUB_LOG, 'utf8').trim().split('\n').filter(Boolean) : []
const uniqueTo = new Set(dispatches.map(d => JSON.parse(d).to))
line(`C3 despachos recibidos por el daemon (stub): ${dispatches.length} | teléfonos únicos: ${uniqueTo.size} PASS=${dispatches.length === 2 && uniqueTo.size === 2}`)

// C4. Anti-ban nocturno: processNextItem fuera de horario → PAUSED_OFF_HOURS (0 envíos)
const campN = await engine.createCampaign({
  organizationId: 'org_e2e_ultra_postpub',
  name: 'E2E PostPub C nocturna',
  templateSpintax: 'Hola {{nombre}}',
  csvContent: 'phone,name\n573005554433,Noche',
})
const nightDate = new Date('2026-10-27T03:00:00-05:00') // 03:00 Bogotá
const n1 = await engine.processNextItem(campN.id, nightDate)
line(`C4 anti-ban nocturno (03:00 Bogotá): ${n1.status} PASS=${n1.status === 'PAUSED_OFF_HOURS'}`)

// C5. Ingesta realtime en el server vivo :3004
const okLead = await (await fetch('http://localhost:3004/api/audiences/webhook-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '573005556667', name: 'Lead Live E2E', source: 'e2e-postpub' }) })).json()
const badLead = await (await fetch('http://localhost:3004/api/audiences/webhook-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'telefono-malo', name: 'X' }) })).json()
line(`C5 ingesta lead válido: success=${okLead.success} PASS=${okLead.success === true} | teléfono inválido: ${badLead.reason} PASS=${badLead.reason === 'INVALID_PHONE_FORMAT'}`)
let persisted = 0
try {
  const Database = (await import('better-sqlite3')).default
  const udb = new Database('/home/z/repos/WHATSPOWER-ULTRA/db/broadcast.db', { readonly: true })
  persisted = udb.prepare("SELECT count(*) c FROM realtime_leads WHERE phone LIKE '%573005556667%'").get().c
  udb.close()
} catch (e) { line(`C5 (aviso lectura BD ULTRA: ${String(e).slice(0, 60)})`) }
line(`C5' lead persistido en BD de ULTRA: ${persisted} fila(s) PASS=${persisted >= 1}`)

try { const pid = execSync("ss -tlnp | rg ':3012' | rg -o 'pid=[0-9]+' | head -1").toString().replace('pid=', '').trim(); if (pid) process.kill(Number(pid)) } catch {}
writeFileSync('/home/z/my-project/download/e2e-postpub/C-ultra-daemon.txt', EVID.join('\n') + '\n')
console.log('EVIDENCIA C guardada')
