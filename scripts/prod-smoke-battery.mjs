// BATERÍA DE HUMO — VENTANA DE PRODUCCIÓN CONTROLADA R2 (2026-10-28)
// Secretos llegan por process.env (cargados por el orquestador desde archivo 600).
// Jamás se imprimen valores: solo IDs de chequeo, códigos HTTP y estados.
// Nada de despacho real: no se invoca ningún envío; teléfonos de prueba 5730000000x.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'
const require = createRequire(import.meta.url)

// Mata el proceso que escucha en un puerto (para reinicio REAL en la prueba de persistencia)
async function killPort(port) {
  const { execSync } = require('node:child_process')
  try {
    const out = execSync(`ss -tlnp | grep ':${port} '`).toString()
    const pids = [...new Set([...out.matchAll(/pid=(\d+)/g)].map(m => m[1]))]
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGTERM') } catch {} }
  } catch {}
}
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const S_INTERNAL = process.env.S_INTERNAL
const S_WEBHOOK = process.env.S_WEBHOOK
if (!S_INTERNAL || !S_WEBHOOK) { console.error('FATAL: secretos no presentes en env'); process.exit(2) }

const WP = '/home/z/repos-limpio/WHATSPOWER'
const CRM = '/home/z/repos-limpio/CRM-ALBRA'
const WP_BASE = 'http://localhost:3003'
const DAEMON_BASE = 'http://localhost:3002'
const CRM_BASE = 'http://localhost:3100'
const TEST_PHONE_A = '57300000001'
const TEST_PHONE_B = '57300000002'

// Valores VIEJOS = extraídos en vivo de la historia git publicada (nunca impresos)
function oldValuesFromGit() {
  const { execSync } = require('node:child_process')
  const out = execSync('git show db0d088:src/server.ts', { cwd: WP, encoding: 'utf8' })
  const set = new Set()
  for (const m of out.matchAll(/'(dev_secret_shared_albra_2a|crm_albra_internal_secret_key_fixed_length[a-z0-9_]*)'/g)) set.add(m[1])
  return [...set]
}
const OLD_VALUES = oldValuesFromGit()
console.log(`valores viejos recuperados de historia git: ${OLD_VALUES.length} (ocultos)`)
const OLD_INTERNAL = OLD_VALUES.find(v => v.startsWith('crm_albra_')) || OLD_VALUES[0]
const OLD_WEBHOOK = OLD_VALUES.find(v => v.startsWith('dev_secret_')) || OLD_VALUES[1]

const results = []
function check(id, ok, detail = '') {
  results.push({ id, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`)
}
async function jfetch(url, opts = {}) {
  const res = await fetch(url, opts)
  let body = null
  try { body = await res.json() } catch { try { body = await res.text() } catch {} }
  return { status: res.status, body }
}
const bearer = (v) => ({ Authorization: `Bearer ${v}` })

// ---------- FASE A: HEALTH ----------
{
  const r = await jfetch(`${WP_BASE}/api/health`)
  check('S1 WP health', r.status === 200 && r.body?.status === 'ok', `HTTP ${r.status}`)
}
{
  const r = await jfetch(`${DAEMON_BASE}/status`, { headers: bearer(S_INTERNAL) })
  check('S2 daemon /status con NUEVO Bearer', r.status === 200 && typeof r.body?.status === 'string', `HTTP ${r.status} status=${r.body?.status}`)
  globalThis.daemonStatus = r.body?.status
}
{
  const r = await jfetch(`${CRM_BASE}/api/health`)
  check('S3 CRM health', r.status === 200, `HTTP ${r.status}`)
}

// ---------- FASE B: AUTENTICACIÓN (NUEVO acepta / VIEJO y ausente rechazan) ----------
{
  const r = await jfetch(`${DAEMON_BASE}/status`, { headers: bearer(OLD_INTERNAL) })
  check('S4 daemon con secreto VIEJO (publicado en historia) → 401', r.status === 401, `HTTP ${r.status}`)
}
{
  const r = await jfetch(`${DAEMON_BASE}/status`)
  check('S5 daemon sin Bearer → 401', r.status === 401, `HTTP ${r.status}`)
}
{
  const r = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_A}`, {
    method: 'POST', headers: { ...bearer(S_INTERNAL), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'smoke-r2' }),
  })
  check('S6 WP suppression POST con NUEVO → 2xx', r.status >= 200 && r.status < 300, `HTTP ${r.status}`)
}
{
  const r = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_A}`, {
    method: 'POST', headers: { ...bearer(OLD_INTERNAL), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'smoke-r2-old' }),
  })
  check('S7 WP suppression POST con VIEJO → 401', r.status === 401, `HTTP ${r.status}`)
}
{
  const r = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_A}`, { method: 'POST' })
  check('S8 WP suppression POST sin Bearer → 401', r.status === 401, `HTTP ${r.status}`)
}
{
  const r = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_A}`)
  check('S9 WP suppression GET refleja la baja', r.status === 200 && r.body?.suppressed === true, `HTTP ${r.status} suppressed=${r.body?.suppressed}`)
}
{
  const r = await jfetch(`${WP_BASE}/qr/data`, { headers: bearer(S_INTERNAL) })
  check('S10 WP /qr/data proxied con NUEVO → 200', r.status === 200 && r.body && typeof r.body.status === 'string', `HTTP ${r.status} daemonQrStatus=${r.body?.status}`)
}

// ---------- FASE C: CRM ↔ WP (HMAC) y CRM ↔ daemon ----------
{
  const r = await jfetch(`${CRM_BASE}/api/doctor`, { headers: { Authorization: `Bearer ${process.env.SMOKE_TOKEN || ''}` } })
  const checks = r.body?.checks || []
  const by = Object.fromEntries(checks.map(c => [c.id, c.status]))
  const whatsapp = checks.find(c => c.id === 'whatsapp')
  const security = checks.find(c => c.id === 'security')
  check('S13 CRM doctor (JWT admin): db+schema+security', r.status === 200 && by.db === 'ok' && by.schema === 'ok' && by.security === 'ok',
    `HTTP ${r.status} db=${by.db} schema=${by.schema} security=${by.security} detail=${(security?.detail || '').replace(/\d+/g, 'N')} chars`)
  check('S13b CRM→daemon autenticado con NUEVO (doctor whatsapp ok)', whatsapp?.status === 'ok', `status=${whatsapp?.status} detail=${(whatsapp?.detail || '').slice(0, 80)}`)
}
async function bridgeAttempt(secret) {
  const prev = process.env.WHATSPOWER_WEBHOOK_SECRET
  process.env.WHATSPOWER_WEBHOOK_SECRET = secret
  process.env.WHATSPOWER_ENABLED = 'true'
  process.env.WHATSPOWER_INBOUND_URL = `${WP_BASE}/api/inbound`
  const mod = await import(`${CRM}/src/lib/whatspower-bridge.ts`)
  const out = await mod.forwardInboundToWhatspower({
    orgId: 'smoke-r2-org', phone: TEST_PHONE_A, name: 'SMOKE R2', text: '[SMOKE R2] prueba de integración', messageId: `smoke_${randomUUID()}`,
  })
  if (prev === undefined) delete process.env.WHATSPOWER_WEBHOOK_SECRET; else process.env.WHATSPOWER_WEBHOOK_SECRET = prev
  return out
}
{
  const out = await bridgeAttempt(S_WEBHOOK)
  check('S11 CRM→WP inbound HMAC con NUEVO webhook secret', out.sent === true, JSON.stringify(out).replace(/[A-Za-z0-9+/=]{24,}/g, '***'))
}
{
  const out = await bridgeAttempt(OLD_WEBHOOK)
  check('S12 CRM→WP inbound con VIEJO webhook secret rechazado', out.sent === false && out.status !== undefined && out.status !== 200, `sent=${out.sent} status=${out.status}`)
}

// ---------- FASE D: PERSISTENCIA (supervivencia a reinicio de WP) ----------
async function startWP(extraEnv = {}) {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/server.ts'], {
    cwd: WP, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'ignore', 'ignore'], detached: false,
  })
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    try { const r = await jfetch(`${WP_BASE}/api/health`); if (r.status === 200) return child } catch {}
  }
  throw new Error('WP no arrancó')
}
{
  const r1 = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_B}`, {
    method: 'POST', headers: { ...bearer(S_INTERNAL), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'smoke-r2-persist' }),
  })
  check('S14a POST baja phoneB', r1.status >= 200 && r1.status < 300, `HTTP ${r1.status}`)
  await killPort(3003)
  await sleep(1500)
  globalThis.wpChild = await startWP()
  const r2 = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_B}`)
  check('S14b baja sobrevive reinicio (persistencia en disco)', r2.status === 200 && r2.body?.suppressed === true, `HTTP ${r2.status} suppressed=${r2.body?.suppressed}`)
  const r3 = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_B}`, { method: 'DELETE', headers: bearer(S_INTERNAL) })
  check('S14c DELETE autorizado con NUEVO → 2xx', r3.status >= 200 && r3.status < 300, `HTTP ${r3.status}`)
  const r4 = await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_B}`)
  check('S14d baja eliminada', r4.status === 200 && r4.body?.suppressed === false, `suppressed=${r4.body?.suppressed}`)
  // limpieza phone A
  await jfetch(`${WP_BASE}/api/internal/suppression/${TEST_PHONE_A}`, { method: 'DELETE', headers: bearer(S_INTERNAL) })
}

// ---------- FASE E: FAIL-CLOSED EN VIVO ----------
{
  const tmpCwd = mkdtempSync(join(tmpdir(), 'wp-noenv-'))
  // .env presente pero SIN INTERNAL_API_SECRET (loadEnvFile no debe lanzar; la ruta debe fallar cerrada)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(tmpCwd, '.env'), 'PORT=3004\nNODE_ENV=production\n')
  const child = spawn(process.execPath, ['/home/z/repos-limpio/WHATSPOWER/src/server.ts'], {
    cwd: tmpCwd, env: { PATH: process.env.PATH, PORT: '3004', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const errBuf = []
  child.stderr.on('data', d => errBuf.push(String(d)))
  let up = false
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    try { const h = await jfetch('http://localhost:3004/api/health'); if (h.status === 200) { up = true; break } } catch {}
  }
  try {
    if (!up) throw new Error('no arrancó: ' + (errBuf.join('').split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 100)))
    const r1 = await jfetch('http://localhost:3004/api/internal/suppression/57300000009', { method: 'POST' })
    const r2 = await jfetch('http://localhost:3004/qr/data')
    check('S15 WP sin INTERNAL_API_SECRET: POST → 401 y /qr/data → 503', r1.status === 401 && r2.status === 503, `POST=${r1.status} qr=${r2.status}`)
  } catch (e) {
    check('S15 WP sin INTERNAL_API_SECRET: POST → 401 y /qr/data → 503', false, String(e.message).slice(0, 120))
  }
  child.kill('SIGTERM')
  await sleep(300)
  rmSync(tmpCwd, { recursive: true, force: true })
}
{
  const out = spawn(process.execPath, ['--experimental-strip-types', '/home/z/my-project/scripts/fc-crypto-nokey.mjs'], {
    env: { PATH: process.env.PATH }, stdio: 'pipe',
  })
  const buf = []
  out.stdout.on('data', d => buf.push(String(d)))
  await new Promise(res => out.on('close', res))
  check('S16 CRM crypto sin clave → error de configuración (fail-closed)', buf.join('').includes('CONFIG-ERROR-OK'), buf.join('').trim().slice(0, 80))
}

const fails = results.filter(r => !r.ok).length
console.log(`\nBATERÍA PRINCIPAL: ${results.length - fails}/${results.length} PASS`)
process.exit(fails ? 1 : 0)
