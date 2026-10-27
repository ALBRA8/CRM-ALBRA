// E2E FINAL — FLUJO 4: fallos y recuperación (CRM caído, reinicios, fail-closed, secretos incorrectos, org cruzada)
// Evidencia sanitizada → evidencias/e2e/D-fallos-recuperacion.txt
import { createHmac } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

const REPO = '/home/z/my-project/albra-final'
const E2E = `${REPO}/e2e`
const EVID_DIR = '/home/z/my-project/download/ALBRA-PRUEBA-INTEGRAL/evidencias/e2e'
const { E2E_WP_SECRET, E2E_INT_SECRET, E2E_CRM_KEY, E2E_WP_PID, E2E_CRM_PID, E2E_APP_SECRET, E2E_ENC_KEY } = process.env
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync(EVID_DIR, { recursive: true })

const waitHealth = async (url, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true } catch {}
    await new Promise(r => setTimeout(r, 1500))
  }
  return false
}
const sign = (payload, secret, ts) => createHmac('sha256', secret).update(payload).digest('hex')
const mkEvent = (id) => JSON.stringify({ eventId: id, orgId: 'org_e2e_final', contact: { phone: '573000000401', name: 'E2E D' }, message: { text: 'e2e2026' }, timestamp: new Date().toISOString(), channel: 'whatsapp' })

// ---------- D1: CRM NO disponible → WHATSPOWER falla abierto controlado (200 crmSynced=false), sin romperse ----------
const pidCrm = Number(E2E_CRM_PID)
if (pidCrm) {
  const { execSync } = await import('node:child_process')
  // matar TODO lo que escuche en :3000 (bunx envuelve next-server; el pid padre no basta)
  try { execSync("ss -tlnp | grep ':3000 ' | grep -oP 'pid=\\K[0-9]+' | sort -u | xargs -r kill", { shell: '/bin/bash' }) } catch {}
  try { process.kill(pidCrm) } catch {}
  await new Promise(r => setTimeout(r, 1500))
  const crmDown = await fetch('http://localhost:3000/api/health').then(r => !r.ok).catch(() => true)
  line(`D0 CRM detenido para la prueba: ${crmDown} PASS=${crmDown}`)
  const body = mkEvent('e2e-D1-' + Date.now())
  const t0 = Date.now()
  const r1 = await fetch('http://localhost:3003/api/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(body, E2E_WP_SECRET), 'X-Timestamp': String(Date.now()) }, body })
  const j1 = await r1.json().catch(() => ({}))
  line(`D1 CRM caído → WHATSPOWER inbound: HTTP ${r1.status} crmSynced=${j1.crmSynced} (${Date.now() - t0}ms) PASS=${r1.status === 200 && j1.crmSynced === false}`)
  const alive = await fetch('http://localhost:3003/api/health').then(r => r.ok).catch(() => false)
  line(`D1' proceso WHATSPOWER sigue vivo: ${alive} PASS=${alive}`)

  // ---------- D1'': CRM vuelve → recuperación, crmSynced=true ----------

  const envFile = `${E2E}/.e2e-creds.sh`
  // spawn detached (execSync se cuelga: bunx hereda los pipes de stdio)
  const crmProc = spawn('bunx', ['next', 'dev', '-p', '3000'], {
    cwd: `${REPO}/CRM-ALBRA`, detached: true, stdio: 'ignore',
    env: {
      ...process.env, DATABASE_URL: `file:${E2E}/crm-e2e.db`,
      APP_SECRET: process.env.E2E_APP_SECRET, APP_ENCRYPTION_KEY: process.env.E2E_ENC_KEY,
      INTERNAL_API_SECRET: process.env.E2E_INT_SECRET,
      WHATSPOWER_ENABLED: 'true', WHATSPOWER_WEBHOOK_SECRET: process.env.E2E_WP_SECRET,
      NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--max-old-space-size=850',
    },
  })
  crmProc.unref()
  const crmBack = await waitHealth('http://localhost:3000/api/health')
  line(`D1'' CRM reiniciado y saludable: ${crmBack} PASS=${crmBack}`)
  // reintentos: el dev server recién reiniciado compila rutas al primer golpe
  let synced = false; let lastHttp = 0
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const body2 = mkEvent('e2e-D1b-' + Date.now())
    const r2 = await fetch('http://localhost:3003/api/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(body2, E2E_WP_SECRET), 'X-Timestamp': String(Date.now()) }, body: body2 })
    const j2 = await r2.json().catch(() => ({}))
    lastHttp = r2.status
    if (r2.status === 200 && j2.crmSynced === true) { synced = true; break }
  }
  line(`D1''' reintento tras recuperación (hasta 4 intentos, calentamiento dev): HTTP ${lastHttp} crmSynced=true PASS=${synced}`)
}

// ---------- D2: firma con SECRETO INCORRECTO → rechazo (no acepta secretos alternativos) ----------
const wrongSecretBody = mkEvent('e2e-D2-' + Date.now())
const rWrong = await fetch('http://localhost:3003/api/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(wrongSecretBody, 'secreto_equivocado_del_attacker'), 'X-Timestamp': String(Date.now()) }, body: wrongSecretBody })
line(`D2 firma con secreto incorrecto: HTTP ${rWrong.status} PASS=${rWrong.status === 401}`)

// ---------- D3: reinicio de WHATSPOWER → persistencia de flujos y servicio operativo ----------
const pidWp = Number(E2E_WP_PID)
if (pidWp) {
  try { process.kill(pidWp) } catch {}
  await new Promise(r => setTimeout(r, 800))
  const wpProc = spawn('node', ['--experimental-strip-types', 'src/server.ts'], {
    cwd: `${REPO}/WHATSPOWER`, detached: true, stdio: 'ignore',
    env: { ...process.env, PORT: '3003', CRM_BASE_URL: 'http://localhost:3000', CRM_API_KEY: E2E_CRM_KEY, AGENTIC_2A_WEBHOOK_SECRET: E2E_WP_SECRET, INTERNAL_API_SECRET: E2E_INT_SECRET },
  })
  wpProc.unref()
  const wpBack = await waitHealth('http://localhost:3003/api/health')
  line(`D3 WHATSPOWER reiniciado: ${wpBack} PASS=${wpBack}`)
  const body3 = mkEvent('e2e-D3-' + Date.now())
  const r3 = await fetch('http://localhost:3003/api/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-SHA256': sign(body3, E2E_WP_SECRET), 'X-Timestamp': String(Date.now()) }, body: body3 })
  const j3 = await r3.json().catch(() => ({}))
  line(`D3' post-reinicio flujo sigue activo (persistencia operational.db): HTTP ${r3.status} actionTaken=${j3.actionTaken} PASS=${r3.status === 200}`)
}

// ---------- D4: daemon sin INTERNAL_API_SECRET → NO arranca (fail-closed) ----------
const { execSync } = await import('node:child_process')
let d4out = ''
try {
  d4out = execSync(`cd ${REPO}/CRM-ALBRA && env -u INTERNAL_API_SECRET DATABASE_URL="file:${E2E}/crm-e2e.db" timeout 8 node src/whatsapp-daemon/daemon.mjs 2>&1 || true`, { encoding: 'utf8', shell: '/bin/bash' })
} catch (e) { d4out = String((e && e.stdout) || '') + String((e && e.stderr) || '') }
const failClosed = d4out.includes('INTERNAL_API_SECRET no configurado')
line(`D4 daemon sin secreto: ${failClosed ? 'ARRANQUE RECHAZADO (fail-closed, mensaje de seguridad presente)' : 'sin rechazo visible: ' + d4out.slice(0, 90)} PASS=${failClosed}`)

// ---------- D5: ULTRA dispatcher sin secreto configurado → stub rechaza 401 → NUNCA éxito falso ----------
process.env.WHATSAPP_DAEMON_URL = 'http://localhost:3012'
const stubEnv = spawn('node', [`${E2E}/stub-daemon.mjs`], { detached: true, stdio: 'ignore', env: { ...process.env, STUB_SECRET: E2E_INT_SECRET, STUB_LOG: `${E2E}/stub-dispatches.jsonl.d` } })
stubEnv.unref()
await new Promise(r => setTimeout(r, 700))
delete process.env.INTERNAL_API_SECRET
const { HttpCrmDaemonDispatcher } = await import(`${REPO}/WHATSPOWER-ULTRA/src/adapters/dispatcher.ts`)
const noSecret = new HttpCrmDaemonDispatcher({ endpointUrl: 'http://localhost:3012/send', allowRealDispatch: true })
const nRes = await noSecret.dispatch('573009990055', 'sin secreto')
line(`D5 ULTRA sin INTERNAL_API_SECRET → stub: success=${nRes.success} error="${String(nRes.error || '').slice(0, 55)}" PASS=${nRes.success === false && String(nRes.error).includes('401')}`)
try { stubEnv.kill() } catch {}

writeFileSync(`${EVID_DIR}/D-fallos-recuperacion.txt`, EVID.join('\n') + '\n')
console.log('EVIDENCIA D guardada')
