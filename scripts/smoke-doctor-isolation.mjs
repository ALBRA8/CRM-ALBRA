/**
 * Smoke EN VIVO del P0.2 — aislamiento de ejecuciones del Doctor (multi-tenant).
 * Contra el CRM real (:3000, next dev) con dos organizaciones reales creadas por API.
 *
 * NUNCA imprime secretos ni tokens; solo estados HTTP y resúmenes.
 * Nota de diseño: el scheduler de plataforma (instrumentation.ts) barre runs
 * 'running' con >10 min cada 60s (sweeper legítimo, sin origen humano). El Doctor
 * actúa sobre >15 min. Para eliminar la carrera, el smoke reintenta y DISTINGUE
 * al autor por el texto del error: 'marcado por Doctor' vs 'sweeper'.
 *
 * Casos:
 *  P2-1 /api/doctor anónimo                       → 401
 *  P2-2 /api/doctor?fix=1 con rol agent           → 403
 *  P2-3 fix=1 del owner A: run de A marcado
 *       'failed' por el Doctor Y run de B SIGUE
 *       'running' (escritura cross-tenant nula)   ← prueba negativa central
 *  P2-4 doctor de A no cuenta la huérfana de B    → huerfanas(A) === 0
 *  P2-5 org/organizationId en query NO cambian el alcance (org del JWT)
 *  P2-6 fix=1 del owner B: SU run queda 'failed' por el Doctor
 *  P2-7 limpieza total (orgs A y B eliminadas, cascade; sin basura)
 */
import { randomBytes, scryptSync } from 'node:crypto'
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

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

async function registerOrg(name, email, company) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'SmokeTest2026*', company }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.status !== 200 || !body.token) throw new Error(`register ${email} → ${res.status} ${String(body.error || '')}`)
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${body.token}` } })
  const meBody = await me.json().catch(() => ({}))
  const orgId = meBody?.user?.organizationId || meBody?.organization?.id
  return { token: body.token, orgId }
}

async function seedOrphanRun(orgId, name) {
  const automation = await db.automation.create({
    data: { organizationId: orgId, name, triggerType: 'manual', isActive: true, actions: JSON.stringify([{ type: 'internal_note', config: { text: 'smoke' } }]) },
  })
  const run = await db.automationRun.create({
    data: { organizationId: orgId, automationId: automation.id, status: 'running', startedAt: new Date(Date.now() - 16 * 60_000) },
  })
  return { automationId: automation.id, runId: run.id }
}

async function cleanupAutomation(automationId) {
  await db.automation.delete({ where: { id: automationId } }).catch(() => {})
}

async function doctorGet(token, query) {
  const res = await fetch(`${BASE}/api/doctor${query}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function main() {
  const stamp = Date.now().toString(36)

  // ---- Organizaciones A y B reales (por API) ----
  const A = await registerOrg('Tester Doctor A', `smoke-doc-a-${stamp}@test.local`, `Doctor Iso A ${stamp}`)
  const B = await registerOrg('Tester Doctor B', `smoke-doc-b-${stamp}@test.local`, `Doctor Iso B ${stamp}`)
  check('P2-0 setup: orgs A y B creadas por API', !!A.orgId && !!B.orgId)

  // ---- Usuario agent en A (no admin) creado por BD + login por API ----
  await db.user.create({
    data: { email: `smoke-doc-agent-${stamp}@test.local`, name: 'Agent A', passwordHash: hashPassword('SmokeTest2026*'), role: 'agent', organizationId: A.orgId },
  })
  const loginAgent = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `smoke-doc-agent-${stamp}@test.local`, password: 'SmokeTest2026*' }),
  })
  const agentBody = await loginAgent.json().catch(() => ({}))
  const agentToken = agentBody.token
  check('P2-0b login del agent A', loginAgent.status === 200 && !!agentToken)

  // ---- Guardias de acceso ----
  const anon = await fetch(`${BASE}/api/doctor?fix=1`)
  check('P2-1 doctor anónimo → 401', anon.status === 401, `(got ${anon.status})`)

  const agent = await doctorGet(agentToken, '?fix=1')
  check('P2-2 doctor agent → 403', agent.res.status === 403, `(got ${agent.res.status})`)

  // ---- P2-3: prueba negativa central con reintentos (carrera benigna del sweeper) ----
  let p2_3 = false
  for (let attempt = 1; attempt <= 4 && !p2_3; attempt++) {
    const a = await seedOrphanRun(A.orgId, `doc-a-${stamp}-${attempt}`)
    const b = await seedOrphanRun(B.orgId, `doc-b-${stamp}-${attempt}`)
    const { res, body } = await doctorGet(A.token, '?fix=1')
    const runA = await db.automationRun.findUnique({ where: { id: a.runId } })
    const runB = await db.automationRun.findUnique({ where: { id: b.runId } })
    const okA = res.status === 200 && body.organizationId === A.orgId && runA?.status === 'failed' && String(runA?.error || '').includes('Doctor')
    const okB = runB?.status === 'running' && runB?.error === null
    p2_3 = okA && okB
    if (p2_3) {
      check('P2-3 fix de A marca SOLO su run; el de B sigue running', true, `(intentos: ${attempt})`)
    } else if (String(runB?.error || '').includes('sweeper') || String(runA?.error || '').includes('sweeper')) {
      console.log(`[smoke]   intento ${attempt}: el sweeper de plataforma barrió antes (benigno); reintentando`)
    } else {
      check('P2-3 fix de A marca SOLO su run; el de B sigue running', false, `(A:${runA?.status}/${String(runA?.error).slice(0, 40)} B:${runB?.status}/${String(runB?.error).slice(0, 40)})`)
      break
    }
    await cleanupAutomation(a.automationId)
    await cleanupAutomation(b.automationId)
  }
  if (!p2_3) check('P2-3 fix de A marca SOLO su run; el de B sigue running', false, '(agotados reintentos)')

  // ---- P2-4: A no cuenta la huérfana de B ----
  const b4 = await seedOrphanRun(B.orgId, `doc-b-count-${stamp}`)
  const diagA = await doctorGet(A.token, '')
  const autoA = diagA.body?.checks?.find((c) => c.id === 'automations')
  check('P2-4 doctor de A: huerfanas === 0 (no ve las de B)', diagA.res.status === 200 && autoA?.data?.huerfanas === 0, `(huerfanas=${autoA?.data?.huerfanas})`)

  // ---- P2-5: manipulación de query no cambia el alcance ----
  const q = await doctorGet(A.token, `?org=${B.orgId}&organizationId=${B.orgId}`)
  check('P2-5 query con org/organizationId ajenos → la org sigue siendo la del JWT', q.res.status === 200 && q.body.organizationId === A.orgId, `(org=${q.body?.organizationId})`)

  // ---- P2-6: el owner de B arregla SU ejecución (retry ante sweeper) ----
  let p2_6 = false
  for (let attempt = 1; attempt <= 4 && !p2_6; attempt++) {
    const b6 = await seedOrphanRun(B.orgId, `doc-b-fix-${stamp}-${attempt}`)
    const { res, body } = await doctorGet(B.token, '?fix=1')
    const runB = await db.automationRun.findUnique({ where: { id: b6.runId } })
    p2_6 = res.status === 200 && body.organizationId === B.orgId && runB?.status === 'failed' && String(runB?.error || '').includes('Doctor')
    if (p2_6) {
      check('P2-6 fix de B marca SU ejecución (autonomía legítima del tenant)', true, `(intentos: ${attempt})`)
    } else if (String(runB?.error || '').includes('sweeper')) {
      console.log(`[smoke]   intento ${attempt}: sweeper benigno; reintentando`)
    } else {
      check('P2-6 fix de B marca SU ejecución (autonomía legítima del tenant)', false, `(got ${res.status}, runB=${runB?.status})`)
      break
    }
    await cleanupAutomation(b6.automationId)
  }
  if (!p2_6) check('P2-6 fix de B marca SU ejecución (autonomía legítima del tenant)', false, '(agotados reintentos)')
  await cleanupAutomation(b4.automationId)

  // ---- P2-7: limpieza (sin basura) ----
  await db.organization.delete({ where: { id: A.orgId } }).catch(() => {})
  await db.organization.delete({ where: { id: B.orgId } }).catch(() => {})
  const leftA = await db.organization.findUnique({ where: { id: A.orgId } })
  const leftB = await db.organization.findUnique({ where: { id: B.orgId } })
  check('P2-7 orgs A y B eliminadas (cascade, sin basura)', !leftA && !leftB)

  console.log(`\n[smoke] RESULTADO: ${pass}/${total} ${pass === total ? '✅ TODO OK' : '❌ HAY FALLOS'}`)
  process.exit(pass === total ? 0 : 1)
}

main()
  .catch((err) => {
    console.error('[smoke] Error:', err.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
