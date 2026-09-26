/**
 * Verificación E2E pendiente de la Fase 2 (worklog Task 15):
 *  1. POST /api/auth/demo  → sesión (token + cookie)
 *  2. GET  /api/settings   → leadRouting.autoAssignLeads visible
 *  3. PUT  /api/settings   → toggle persistente (antes fallaba 500 por cliente Prisma viejo)
 *  4. POST /api/clients x3 sin assignedToId → round-robin reparte entre miembros
 */
const BASE = 'http://localhost:3000'
let failures = 0

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

// 1. Login demo
const loginRes = await fetch(`${BASE}/api/auth/demo`, { method: 'POST' })
const setCookie = loginRes.headers.get('set-cookie') || ''
const loginJson = await loginRes.json()
check('POST /api/auth/demo → 200', loginRes.ok, `status ${loginRes.status}`)
const token = loginJson.token
check('respuesta trae token + user', Boolean(token && loginJson.user?.id), `org=${loginJson.organization?.id ?? loginJson.user?.organizationId}`)
check('Set-Cookie albra_session HttpOnly', /albra_session=.*HttpOnly/i.test(setCookie) || /httponly/i.test(setCookie))

const auth = { Authorization: `Bearer ${token}`, Cookie: setCookie.split(';')[0] || `albra_session=${setCookie}` }

// 2. GET settings
const s1 = await fetch(`${BASE}/api/settings`, { headers: auth })
const s1j = await s1.json()
check('GET /api/settings → 200', s1.ok, `status ${s1.status}`)
const autoAssign = s1j?.leadRouting?.autoAssign
check('leadRouting.visible en settings', autoAssign !== undefined, `valor=${autoAssign}`)

// 3. PUT settings (toggle ON)
const putRes = await fetch(`${BASE}/api/settings`, {
  method: 'PUT',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ leadRouting: { autoAssignLeads: true } }),
})
check('PUT /api/settings (autoAssignLeads=true) → 200/OK', putRes.ok, `status ${putRes.status} — antes fallaba 500 por cliente Prisma viejo`)
const s2 = await fetch(`${BASE}/api/settings`, { headers: auth })
const s2j = await s2.json()
const persisted = s2j?.leadRouting?.autoAssign
check('toggle PERSISTIDO tras re-GET', persisted === true, `valor=${persisted}`)

// 4. Round-robin: 3 clientes sin responsable
const membersRes = await fetch(`${BASE}/api/team`, { headers: auth })
const membersJ = await membersRes.json()
const members = Array.isArray(membersJ) ? membersJ : membersJ?.members ?? []
check('GET /api/team → miembros listados', members.length > 0, `${members.length} miembros`)

const created = []
for (let i = 1; i <= 3; i++) {
  const res = await fetch(`${BASE}/api/clients`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `RR-Verify ${i} ${Date.now()}`,
      email: `rr-verify-${Date.now()}-${i}@test.local`,
      phone: `+5730011${String(Date.now()).slice(-5)}${i}`,
    }),
  })
  const j = await res.json()
  created.push(j)
  check(`POST /api/clients #${i} → 200`, res.ok, `status ${res.status}`)
}
const assignments = created.map((c) => c?.assignedToId ?? c?.client?.assignedToId ?? null)
const distinct = new Set(assignments.filter(Boolean))
check('round-robin asignó responsables (sin humano)', assignments.every(Boolean), `assignedToId=${JSON.stringify(assignments)}`)
check('reparto CIRCULAR entre >1 miembros (si hay >1)', members.length < 2 || distinct.size > 1, `${distinct.size} distintos de ${assignments.length}`)

console.log(`\n${failures === 0 ? '✅ TODO OK' : `❌ ${failures} fallos`}`)
process.exit(0)
