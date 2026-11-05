/**
 * Smoke del plano Super Admin contra el CRM vivo (:3000, next dev).
 * NUNCA imprime tokens ni secretos: firma JWTs en memoria con APP_SECRET
 * (leído de .env) y solo muestra estados HTTP y resúmenes de JSON.
 *
 * Casos:
 *  1. GET /api/super/overview sin auth        → 401
 *  2. GET /api/super/overview con rol owner   → 403 (un owner NO ve otras orgs)
 *  3. GET /api/super/overview con superadmin  → 200 + resumen
 *  4. GET /super sin cookie                   → redirect (middleware)
 *  5. GET /super con cookie de superadmin     → 200 HTML
 *  6. La respuesta del overview no filtra secretos (scan de valores largos)
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.CRM_BASE_URL || 'http://localhost:3000'
const db = new PrismaClient()

function loadEnvSecret() {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const line = raw.split('\n').find((l) => l.startsWith('APP_SECRET='))
  // next (y node --env-file) quitan comillas envolventes al parsear .env:
  // hay que firmar con el MISMO valor o la verificación HMAC da 401.
  const secret = line
    ?.slice('APP_SECRET='.length)
    .trim()
    .replace(/^["']|["']$/g, '')
  if (!secret || secret.length < 24) throw new Error('APP_SECRET ausente o débil en .env')
  return secret
}

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function signToken(secret, payload, days = 1) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = { ...payload, exp: Date.now() + days * 86400_000 }
  const claims = b64url(JSON.stringify(body))
  const sig = createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${sig}`
}

function summary(obj, depth = 0) {
  if (obj == null) return 'null'
  if (Array.isArray(obj)) return `[${obj.length} items]`
  if (typeof obj === 'object') {
    if (depth > 1) return '{…}'
    const parts = Object.entries(obj).map(([k, v]) => `${k}: ${summary(v, depth + 1)}`)
    return `{ ${parts.join(', ')} }`
  }
  if (typeof obj === 'string' && obj.length > 60) return `"${obj.slice(0, 40)}…"`
  return JSON.stringify(obj)
}

const SECRET_PATTERNS = [/albra_[0-9a-f]{16,}/i, /[0-9a-f]{40,}/i]

async function main() {
  const appSecret = loadEnvSecret()
  const user = await db.user.findFirst({
    where: { role: 'superadmin' },
    include: { organization: true },
  })
  if (!user) throw new Error('No hay usuario superadmin en BD (corre scripts/promote-superadmin.mjs)')
  console.log(`[smoke] superadmin en BD: ${user.email} (org: ${user.organization.slug})`)

  const claims = { userId: user.id, orgId: user.organizationId, email: user.email }
  const tokenSuper = signToken(appSecret, { ...claims, role: 'superadmin' })
  const tokenOwner = signToken(appSecret, { ...claims, role: 'owner' })

  let pass = 0
  const total = 6

  // 1. sin auth
  const r1 = await fetch(`${BASE}/api/super/overview`)
  const ok1 = r1.status === 401
  console.log(`[smoke] T1 overview sin auth → ${r1.status} (esperado 401) ${ok1 ? 'PASS' : 'FAIL'}`)
  if (ok1) pass++

  // 2. owner intenta ver la plataforma
  const r2 = await fetch(`${BASE}/api/super/overview`, {
    headers: { Authorization: `Bearer ${tokenOwner}` },
  })
  const ok2 = r2.status === 403
  console.log(`[smoke] T2 overview con rol owner → ${r2.status} (esperado 403) ${ok2 ? 'PASS' : 'FAIL'}`)
  if (ok2) pass++

  // 3. superadmin ve todo
  const r3 = await fetch(`${BASE}/api/super/overview`, {
    headers: { Authorization: `Bearer ${tokenSuper}` },
  })
  const body3 = await r3.json().catch(() => ({}))
  const ok3 =
    r3.status === 200 &&
    body3.stats &&
    Array.isArray(body3.organizations) &&
    Array.isArray(body3.users) &&
    Array.isArray(body3.systems)
  console.log(`[smoke] T3 overview con superadmin → ${r3.status} (esperado 200) ${ok3 ? 'PASS' : 'FAIL'}`)
  if (ok3) {
    pass++
    console.log(`[smoke]    stats: ${summary(body3.stats)}`)
    for (const s of body3.systems) {
      console.log(`[smoke]    sistema ${s.id}: ${s.status} ${s.latencyMs != null ? `(${s.latencyMs} ms)` : ''} ${JSON.stringify(s.detail).slice(0, 120)}`)
    }
    console.log(`[smoke]    integraciones: ${summary(body3.integrations)}`)
    console.log(`[smoke]    usuarios: ${body3.users.map((u) => `${u.email}(${u.role})`).join(', ')}`)
  }

  // 4. página /super sin cookie → redirect del middleware
  const r4 = await fetch(`${BASE}/super`, { redirect: 'manual' })
  const ok4 = [302, 303, 307, 308].includes(r4.status)
  console.log(`[smoke] T4 /super sin cookie → ${r4.status} (esperado redirect) ${ok4 ? 'PASS' : 'FAIL'}`)
  if (ok4) pass++

  // 5. página /super con cookie de superadmin
  const r5 = await fetch(`${BASE}/super`, {
    headers: { Cookie: `albra_session=${tokenSuper}` },
  })
  const html5 = await r5.text()
  const ok5 = r5.status === 200 && html5.includes('Super Admin')
  console.log(`[smoke] T5 /super con sesión superadmin → ${r5.status} (esperado 200 con panel) ${ok5 ? 'PASS' : 'FAIL'}`)
  if (ok5) pass++

  // 6. ningún secreto en la respuesta del overview
  const raw3 = JSON.stringify(body3)
  const leaked = SECRET_PATTERNS.filter((re) => re.test(raw3))
  const ok6 = leaked.length === 0
  console.log(`[smoke] T6 sin secretos en la respuesta → ${leaked.length === 0 ? 'limpia' : `FILTRADA (${leaked.length})`} ${ok6 ? 'PASS' : 'FAIL'}`)
  if (ok6) pass++

  console.log(`\n[smoke] RESULTADO: ${pass}/${total} ${pass === total ? '✅ TODO OK' : '❌ HAY FALLOS'}`)
  process.exit(pass === total ? 0 : 1)
}

main()
  .catch((err) => {
    console.error('[smoke] Error:', err.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
