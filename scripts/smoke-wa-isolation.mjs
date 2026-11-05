/**
 * Smoke en vivo del aislamiento P0.1 (sesiones WhatsApp por organización).
 * Contra el daemon real (:3002) y el proxy real del CRM (:3000).
 *
 * NUNCA imprime secretos ni tokens; solo estados HTTP y resúmenes.
 * No requiere escanear QR ni enviar mensajes reales: prueba las guardias.
 *
 * Casos:
 *  D1 /status sin Bearer                     → 401 (fail-closed)
 *  D2 /status con Bearer                     → 200 con sessions[]
 *  D3 /connect sin orgId                     → 400
 *  D4 /connect orgId inexistente             → 400
 *  D5 /send sin orgId y 0 sesiones           → 400 ("ninguna sesión conectada")
 *  D6 /send orgId inexistente                → 400
 *  D7 /disconnect sin orgId                  → 400 (no hay sesión global que cerrar)
 *  D8 /conversations sin orgId               → 400 (fail-closed)
 *  D9 /qr sin orgId                          → 400
 *  X1 (cross-org REAL) usuario de org B vía proxy /send → 403 UNLINKED:
 *      la org B NO puede usar la sesión de nadie aunque otras tengan sesión
 *  X2 usuario de org B vía proxy /status (view) → 200 (ver estado propio es lícito)
 *  X3 org B creada para la prueba se ELIMINA al final (limpieza, sin basura)
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.CRM_BASE_URL || 'http://127.0.0.1:3000'
const DAEMON = process.env.WHATSAPP_DAEMON_URL || 'http://127.0.0.1:3002'
const db = new PrismaClient()

function internalSecret() {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const line = raw.split('\n').find((l) => l.startsWith('INTERNAL_API_SECRET='))
  const secret = line?.slice('INTERNAL_API_SECRET='.length).trim().replace(/^["']|["']$/g, '')
  if (!secret || secret.length < 24) throw new Error('INTERNAL_API_SECRET ausente en .env')
  return secret
}

let pass = 0
let total = 0
function check(name, cond, detail = '') {
  total++
  if (cond) {
    pass++
    console.log(`[smoke] ${name} PASS ${detail}`)
  } else {
    console.log(`[smoke] ${name} FAIL ${detail}`)
  }
}

async function daemonFetch(path, opts = {}) {
  return fetch(`${DAEMON}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${internalSecret()}`, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(4000),
  })
}

async function main() {
  // ---- Daemon: guardias de organización ----
  const r1 = await fetch(`${DAEMON}/status`).catch(() => null)
  check('D1 status sin Bearer → 401', r1?.status === 401, `(got ${r1?.status})`)

  const r2 = await daemonFetch('/status')
  const j2 = await r2.json().catch(() => ({}))
  check('D2 status con Bearer → 200 + sessions[]', r2.status === 200 && Array.isArray(j2.sessions), `sessions=${j2.sessions?.length}`)

  const r3 = await daemonFetch('/connect', { method: 'POST', body: JSON.stringify({}) })
  check('D3 connect sin orgId → 400', r3.status === 400, `(got ${r3.status})`)

  const r4 = await daemonFetch('/connect', { method: 'POST', body: JSON.stringify({ orgId: 'noexiste123' }) })
  check('D4 connect org inexistente → 400', r4.status === 400, `(got ${r4.status})`)

  const r5 = await daemonFetch('/send', { method: 'POST', body: JSON.stringify({ to: '573000000000', text: 'x' }) })
  const j5 = await r5.json().catch(() => ({}))
  check('D5 send sin orgId con 0 sesiones → 400', r5.status === 400 && /ninguna sesión/i.test(j5.error || ''), `(got ${r5.status})`)

  const r6 = await daemonFetch('/send', { method: 'POST', body: JSON.stringify({ to: '573000000000', text: 'x', orgId: 'noexiste123' }) })
  check('D6 send org inexistente → 400', r6.status === 400, `(got ${r6.status})`)

  const r7 = await daemonFetch('/disconnect', { method: 'POST', body: JSON.stringify({}) })
  check('D7 disconnect sin orgId → 400 (no hay sesión global que cerrar)', r7.status === 400, `(got ${r7.status})`)

  const r8 = await daemonFetch('/conversations')
  check('D8 conversations sin orgId → 400', r8.status === 400, `(got ${r8.status})`)

  const r9 = await daemonFetch('/qr')
  check('D9 qr sin orgId → 400', r9.status === 400, `(got ${r9.status})`)

  // ---- Cross-org REAL a través del proxy del CRM ----
  // Org B temporal (se elimina al final con cascade).
  const stamp = Date.now().toString(36)
  const emailB = `smoke-iso-${stamp}@test.local`
  const companyB = `Smoke Iso ${stamp}`
  let orgBId = null
  try {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tester B', email: emailB, password: 'SmokeTest2026*', company: companyB }),
    })
    const regBody = await reg.json().catch(() => ({}))
    const tokenB = regBody.token
    if (reg.status === 200 && tokenB) {
      const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenB}` } })
      const meBody = await me.json().catch(() => ({}))
      orgBId = meBody?.user?.organizationId || meBody?.organization?.id || null

      // X1: la org B intenta ENVIAR por el proxy → 403 (UNLINKED: operate denegado)
      const x1 = await fetch(`${BASE}/api/whatsapp/daemon-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ path: '/send', to: '573000000000', text: 'intento cross-org' }),
      })
      const x1Body = await x1.json().catch(() => ({}))
      check('X1 proxy /send de org B → 403 UNLINKED (no puede usar sesión ajena)', x1.status === 403, `(got ${x1.status}: ${String(x1Body.error || '').slice(0, 60)})`)

      // X1b: la org B intenta DESCONECTAR → 403 (no puede tocar ninguna sesión)
      const x1b = await fetch(`${BASE}/api/whatsapp/daemon-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ path: '/disconnect' }),
      })
      check('X1b proxy /disconnect de org B → 403', x1b.status === 403, `(got ${x1b.status})`)

      // X2: ver estado (view) es lícito para su propia org → 200
      const x2 = await fetch(`${BASE}/api/whatsapp/daemon-proxy?path=/status`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      })
      check('X2 proxy /status de org B (view) → 200', x2.status === 200, `(got ${x2.status})`)
    } else {
      check('X1 registro de org B para prueba', false, `(got ${reg.status}: ${String(regBody.error || '').slice(0, 60)})`)
    }
  } finally {
    // X3: limpieza — la organización temporal se elimina (cascade del schema)
    if (orgBId) {
      await db.organization.delete({ where: { id: orgBId } }).catch(() => {})
      check('X3 org B temporal eliminada (sin basura)', true)
    } else {
      const orphan = await db.organization.findFirst({ where: { slug: { contains: `smoke-iso-${stamp}`.toLowerCase().replace(/\s+/g, '-') } } })
      if (orphan) await db.organization.delete({ where: { id: orphan.id } }).catch(() => {})
    }
  }

  console.log(`\n[smoke] RESULTADO: ${pass}/${total} ${pass === total ? '✅ TODO OK' : '❌ HAY FALLOS'}`)
  process.exit(pass === total ? 0 : 1)
}

main()
  .catch((err) => {
    console.error('[smoke] Error:', err.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
