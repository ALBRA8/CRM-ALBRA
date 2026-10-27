// E2E post-publicación — PRUEBA D v2: WHATSPOWER ante CRM NO disponible (fail-open) y recuperación
// Control estricto de procesos: se verifica que el PID que escucha :3003 es el que acabamos de spawnear.
import { createHmac } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'

const { WP_SECRET, CRM_KEY } = process.env
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync('/home/z/my-project/download/e2e-postpub', { recursive: true })

const listenerPid = () => { try { return execSync("ss -tlnp 2>/dev/null | grep ':3003' | grep -o 'pid=[0-9]*' | head -1").toString().replace('pid=', '').trim() } catch { return '' } }
const killPort = async () => {
  for (let i = 0; i < 10; i++) {
    const pid = listenerPid()
    if (!pid) return true
    try { process.kill(Number(pid)) } catch {}
    await new Promise(r => setTimeout(r, 400))
  }
  return !listenerPid()
}
const startWp = (crmUrl) => {
  const c = spawn('node', ['--experimental-strip-types', 'src/server.ts'], {
    cwd: '/home/z/repos/WHATSPOWER', detached: true, stdio: 'ignore',
    env: { ...process.env, PORT: '3003', CRM_BASE_URL: crmUrl, CRM_API_KEY: CRM_KEY, AGENTIC_2A_WEBHOOK_SECRET: WP_SECRET },
  })
  c.unref()
  return c.pid
}
const waitWp = async () => { for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 600)); try { const h = await fetch('http://localhost:3003/api/health'); if (h.ok) return true } catch {} } return false }

const inbound = async (eventId, phone) => {
  const body = JSON.stringify({ eventId, orgId: 'org_e2e_postpub', contact: { phone, name: 'E2E FailOpen' }, message: { text: 'e2e2026' }, timestamp: new Date().toISOString(), channel: 'whatsapp' })
  const sig = createHmac('sha256', WP_SECRET).update(body).digest('hex')
  const t0 = Date.now()
  const r = await fetch('http://localhost:3003/api/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sig, 'X-Timestamp': String(Date.now()) }, body })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, j, lat: Date.now() - t0 }
}

// D1. CRM no disponible (puerto muerto) con verificación de PID
line(`D0 puerto :3003 liberado: ${await killPort()}`)
const pid1 = startWp('http://localhost:3999')
await waitWp()
const listenerOk = String(listenerPid()) === String(pid1)
line(`D1 WHATSPOWER de prueba en :3003 (pid ${pid1}, listener=${listenerPid() || 'ninguno'}) coincide=${listenerOk}`)
if (listenerOk) {
  const r1 = await inbound('e2e-wp-crm-2026-postpub-d10', '573000000311')
  line(`D1' CRM caído → inbound: HTTP ${r1.status} actionTaken=${r1.j.actionTaken} crmSynced=${r1.j.crmSynced} latencia=${r1.lat}ms PASS=${r1.status === 200 && r1.j.crmSynced === false && r1.lat < 5000}`)
  const alive = await fetch('http://localhost:3003/api/health')
  line(`D2 proceso vivo tras fallo de CRM: HTTP ${alive.status} PASS=${alive.status === 200}`)
}

// D3. Recuperación: CRM real de nuevo
await killPort()
const pid2 = startWp('http://localhost:3000')
await waitWp()
const listenerOk2 = String(listenerPid()) === String(pid2)
line(`D3 WHATSPOWER recuperado con CRM real (pid ${pid2}, coincide=${listenerOk2})`)
if (listenerOk2) {
  const r3 = await inbound('e2e-wp-crm-2026-postpub-d20', '573000000312')
  line(`D3' CRM real → inbound: HTTP ${r3.status} actionTaken=${r3.j.actionTaken} crmSynced=${r3.j.crmSynced} PASS=${r3.status === 200 && r3.j.crmSynced === true}`)
  const db = (await import('better-sqlite3')).default
  const cdb = new db('/home/z/my-project/db/custom.db', { readonly: true })
  const c = cdb.prepare("SELECT id FROM Client WHERE phone LIKE '%573000000312%'").get()
  line(`D4 cliente persistido en CRM tras recuperación: ${c ? 'SÍ (' + c.id.slice(0, 8) + '…)' : 'NO'} PASS=${!!c}`)
  cdb.close()
}

writeFileSync('/home/z/my-project/download/e2e-postpub/D-failopen.txt', EVID.join('\n') + '\n')
console.log('EVIDENCIA D guardada')
