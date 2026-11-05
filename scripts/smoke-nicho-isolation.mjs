/**
 * Smoke EN VIVO del P0.3 — /api/nicho: selección de organización cerrada.
 * Contra el CRM real (:3000, next dev) con dos organizaciones reales por API.
 *
 * NUNCA imprime secretos ni tokens; solo estados HTTP y resúmenes.
 *
 * Casos:
 *  N1  GET anónimo sin ?org                    → 401 (sin fallback a "primera org")
 *  N2  GET anónimo ?org=slugB                  → 200 SOLO campos públicos
 *      (sin negociacion / reglas_oro / personality / auto_reply)
 *  N3  GET anónimo ?org=desconocido            → 404 genérico
 *  N4  GET anónimo ?org=traversal              → 400
 *  N5  GET autenticado A con ?org=slugB        → 200 con la marca de A (JWT manda)
 *  N6  rate limit anónimo                      → 429 con Retry-After
 *  N7  PUT con agent (no admin)                → 403
 *  N8  limpieza total (orgs de prueba fuera, sin basura)
 */
import { PrismaClient } from '@prisma/client'

const BASE = process.env.CRM_BASE_URL || 'http://127.0.0.1:3000'
const db = new PrismaClient()

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

async function registerOrg(name, email, company) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'SmokeTest2026*', company }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.status !== 200 || !body.token) throw new Error(`register ${email} → ${res.status} ${String(body.error || '')}`)
  return body.token
}

async function main() {
  const stamp = Date.now().toString(36)
  const companyA = `Nicho Iso A ${stamp}`
  const companyB = `Nicho Iso B ${stamp}`
  const tokenA = await registerOrg('Tester Nicho A', `smoke-nicho-a-${stamp}@test.local`, companyA)
  await registerOrg('Tester Nicho B', `smoke-nicho-b-${stamp}@test.local`, companyB)

  const orgA = await db.organization.findFirst({ where: { slug: { contains: 'nicho-iso-a' } }, orderBy: { createdAt: 'desc' } })
  const orgB = await db.organization.findFirst({ where: { slug: { contains: 'nicho-iso-b' } }, orderBy: { createdAt: 'desc' } })
  check('N0 setup: orgs A y B creadas con slugs', !!orgA?.slug && !!orgB?.slug, `(A=${orgA?.slug} B=${orgB?.slug})`)

  // Owner A configura SU marca por la vía legítima
  const put = await fetch(`${BASE}/api/nicho`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ branding_name: 'Marca A LIVE', rubro: 'Retail A', reglas_oro: ['REGLA SECRETA LIVE'], negociacion: { descuento_maximo: 33, estrategia: 'ESTRATEGIA LIVE' } }),
  })
  check('N0b PUT del owner A → 200', put.status === 200, `(got ${put.status})`)

  // ---- N1: anónimo sin org → 401 ----
  const n1 = await fetch(`${BASE}/api/nicho`)
  check('N1 anónimo sin ?org → 401', n1.status === 401, `(got ${n1.status})`)

  // ---- N2: anónimo con slug público → SOLO campos públicos ----
  const n2 = await fetch(`${BASE}/api/nicho?org=${orgA.slug}`)
  const n2Body = await n2.json().catch(() => ({}))
  const publicOnly =
    n2Body.branding_name === 'Marca A LIVE' &&
    !('negociacion' in n2Body) &&
    !('reglas_oro' in n2Body) &&
    !('personality' in n2Body) &&
    !('auto_reply' in n2Body) &&
    !('raw' in n2Body)
  check('N2 anónimo ?org=A → solo campos públicos', n2.status === 200 && publicOnly, `(got ${n2.status}; claves=${Object.keys(n2Body).join(',')})`)

  // ---- N3: slug desconocido → 404 ----
  const n3 = await fetch(`${BASE}/api/nicho?org=org-que-no-existe-${stamp}`)
  check('N3 slug desconocido → 404', n3.status === 404, `(got ${n3.status})`)

  // ---- N4: traversal → 400/404 (nunca 200) ----
  const n4 = await fetch(`${BASE}/api/nicho?org=${encodeURIComponent('../../etc/passwd')}`)
  check('N4 traversal → no 200', n4.status !== 200, `(got ${n4.status})`)

  // ---- N5: autenticado A con ?org=B → el JWT manda ----
  const n5 = await fetch(`${BASE}/api/nicho?org=${orgB.slug}`, { headers: { Authorization: `Bearer ${tokenA}` } })
  const n5Body = await n5.json().catch(() => ({}))
  check('N5 autenticado A (?org=B ignorado) → marca de A + su config completa', n5.status === 200 && n5Body.branding_name === 'Marca A LIVE' && 'negociacion' in n5Body, `(got ${n5.status}, branding=${n5Body.branding_name})`)

  // ---- N6: rate limit anónimo → 429 ----
  let saw429 = false
  let retryAfter = null
  for (let i = 0; i < 60 && !saw429; i++) {
    const r = await fetch(`${BASE}/api/nicho?org=${orgB.slug}`)
    if (r.status === 429) {
      saw429 = true
      retryAfter = r.headers.get('retry-after')
    }
  }
  check('N6 rate limit anónimo → 429', saw429, `(retry-after=${retryAfter})`)

  // ---- N7: PUT sin permisos de admin → 403 ----
  const { randomBytes, scryptSync } = await import('node:crypto')
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync('SmokeTest2026*', salt, 64).toString('hex')
  await db.user.create({
    data: { email: `smoke-nicho-agent-${stamp}@test.local`, name: 'Agent A Nicho', passwordHash: `scrypt:${salt}:${hash}`, role: 'agent', organizationId: orgA.id },
  })
  const loginAgent = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `smoke-nicho-agent-${stamp}@test.local`, password: 'SmokeTest2026*' }),
  })
  const agentToken = (await loginAgent.json().catch(() => ({}))).token
  const n7 = await fetch(`${BASE}/api/nicho`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ branding_name: 'Hacked' }),
  })
  check('N7 PUT de agent → 403', n7.status === 403, `(got ${n7.status})`)

  // La marca de A sigue intacta tras el intento
  const after = await db.nichoConfig.findUnique({ where: { organizationId: orgA.id } })
  check('N7b intento de escritura no alteró la config de A', after?.brandingName === 'Marca A LIVE')

  // ---- N8: limpieza ----
  await db.organization.delete({ where: { id: orgA.id } }).catch(() => {})
  await db.organization.delete({ where: { id: orgB.id } }).catch(() => {})
  const leftA = await db.organization.findUnique({ where: { id: orgA.id } })
  const leftB = await db.organization.findUnique({ where: { id: orgB.id } })
  check('N8 orgs A y B eliminadas (sin basura)', !leftA && !leftB)

  console.log(`\n[smoke] RESULTADO: ${pass}/${total} ${pass === total ? '✅ TODO OK' : '❌ HAY FALLOS'}`)
  process.exit(pass === total ? 0 : 1)
}

main()
  .catch((err) => {
    console.error('[smoke] Error:', err.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
