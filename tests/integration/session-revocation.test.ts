import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET as clientsGET } from '@/app/api/clients/route'
import { PUT as teamPUT } from '@/app/api/team/[id]/route'
import { POST as forgotPOST } from '@/app/api/auth/forgot-password/route'
import { POST as resetPOST } from '@/app/api/auth/reset-password/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { db } from '@/lib/db'
import { signToken } from '@/lib/auth'
import { FIX, jsonBody, req, routeParams, tokenFor } from '../helpers'

/**
 * Revocación de sesiones PERSISTENTE (segunda reparación — orden §2.A y §6).
 *
 * Demuestra con evidencia reproducible que:
 *  - un JWT emitido antes de una revocación DEJA de funcionar: (a) en el mismo
 *    proceso, (b) tras "REINICIAR el servidor" (nuevo registro de módulos) y
 *    (c) desde OTRA INSTANCIA (otro registro de módulos sin estado compartido
 *    más que la base de datos);
 *  - la desactivación de un empleado y el cambio de contraseña revocan al instante;
 *  - el token de recuperación se consume ATÓMICAMENTE (doble uso concurrente
 *    imposible);
 *  - un usuario desactivado no puede iniciar sesión.
 *
 * El estado de revocación vive SOLO en la base de datos: no hay Map en memoria
 * (la versión anterior de session-invalidation.ts era exactamente eso).
 */

const A = () => tokenFor(FIX.userA) // owner de org-a
const B = () => tokenFor(FIX.userB) // member de org-b

let ownerBToken = ''

beforeEach(async () => {
  // Restaura el estado seed del usuario (por si otro test del archivo lo tocó)
  await db.user.update({ where: { id: FIX.userB.id }, data: { isActive: true, role: 'member', tokenVersion: 0 } })
  await db.user.update({ where: { id: FIX.userA.id }, data: { isActive: true, tokenVersion: 0 } })
  // Owner REAL de org-b (la ruta /api/team/:id exige la misma organización)
  const owner = await db.user.upsert({
    where: { email: 'owner-b@revocation.test' },
    update: { isActive: true, tokenVersion: 0 },
    create: {
      email: 'owner-b@revocation.test',
      name: 'Owner Org B',
      passwordHash: 'scrypt:aa:bb', // sintético: los tests no hacen login con él
      role: 'owner',
      organizationId: FIX.userB.organizationId,
    },
  })
  ownerBToken = tokenFor(owner)
})

async function freshModules() {
  // Simula OTRA INSTANCIA / reinicio: nuevo registro de módulos → cualquier
  // caché en memoria de proceso quedaría vacía; solo la BD persiste.
  vi.resetModules()
  const mod = await import('@/app/api/clients/route')
  return mod.GET
}

describe('revocación persistente — desactivación de empleado', () => {
  it('el JWT del empleado deja de funcionar al instante (mismo proceso)', async () => {
    const alive = await clientsGET(req('/api/clients', { token: B() }))
    expect(alive.status).toBe(200)

    // El owner de la MISMA org desactiva al miembro (ruta real)
    const res = await teamPUT(req('/api/team/' + FIX.userB.id, { method: 'PUT', token: ownerBToken, body: { isActive: false } }), routeParams(FIX.userB.id))
    expect(res.status).toBe(200)

    const dead = await clientsGET(req('/api/clients', { token: B() }))
    expect(dead.status).toBe(401)
  })

  it('tras "reiniciar el servidor" el JWT anterior SIGUE muerto (persistencia)', async () => {
    await teamPUT(req('/api/team/' + FIX.userB.id, { method: 'PUT', token: ownerBToken, body: { isActive: false } }), routeParams(FIX.userB.id))
    // Reinicio simulado: nuevo registro de módulos
    const GET2 = await freshModules()
    const res = await GET2(req('/api/clients', { token: B() }))
    expect(res.status).toBe(401)
  })

  it("desde OTRA INSTANCIA el JWT anterior está revocado (autoridad = BD, no memoria)", async () => {
    // La revocación la ejecuta "otra instancia" (módulos frescos) vía BD;
    // el proceso original NO puede saberlo por memoria — solo por la BD.
    const GET2 = await freshModules()
    await db.user.update({ where: { id: FIX.userB.id }, data: { tokenVersion: { increment: 1 } } })

    // Instancia original (módulos ya cargados) rechaza el token viejo:
    const res1 = await clientsGET(req('/api/clients', { token: B() }))
    expect(res1.status).toBe(401)
    // La "segunda instancia" también:
    const res2 = await GET2(req('/api/clients', { token: B() }))
    expect(res2.status).toBe(401)

    // Un token firmado con la versión VIGENTE (1) funciona en ambas.
    const userB = await db.user.findUnique({ where: { id: FIX.userB.id } })
    const fresh = signToken({ userId: FIX.userB.id, orgId: FIX.userB.organizationId, role: 'member', email: FIX.userB.email, tv: userB!.tokenVersion })
    expect((await clientsGET(req('/api/clients', { token: fresh }))).status).toBe(200)
    expect((await GET2(req('/api/clients', { token: fresh }))).status).toBe(200)
  })
})

describe('revocación persistente — cambio de contraseña (flujo real forgot+reset)', () => {
  it('el JWT emitido antes del reset muere; el consumo del token es de un solo uso', async () => {
    const email = FIX.userA.email
    // 1. Solicita recuperación
    const forgot = await forgotPOST(req('/api/auth/forgot-password', { method: 'POST', body: { email } }))
    expect(forgot.status).toBe(200)
    const { resetToken } = (await jsonBody(forgot)) as { resetToken: string }
    expect(resetToken).toBeTruthy()

    const oldJwt = A()

    // 2. Consume el token con la nueva contraseña
    const reset = await resetPOST(req('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'Nueva-Clave-2026' } }))
    expect(reset.status).toBe(200)

    // 3. El JWT anterior queda revocado (tokenVersion incrementada en el UPDATE del reset)
    expect((await clientsGET(req('/api/clients', { token: oldJwt }))).status).toBe(401)

    // 4. El MISMO token de recuperación NO puede usarse otra vez (doble uso)
    const again = await resetPOST(req('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'Otra-Clave-2026' } }))
    expect(again.status).toBe(400)

    // 5. Login con la nueva contraseña funciona y emite JWT con tv vigente
    const login = await loginPOST(req('/api/auth/login', { method: 'POST', body: { email, password: 'Nueva-Clave-2026' } }))
    expect(login.status).toBe(200)
  })

  it('DOS resets concurrentes con el mismo token: exactamente UNO gana (§2.D atómico)', async () => {
    await forgotPOST(req('/api/auth/forgot-password', { method: 'POST', body: { email: FIX.userA.email } }))
    // Recupera el token del último forgot directamente de BD (hash) no — necesitamos el claro:
    // lo pedimos de nuevo y lo leemos del payload dev.
    const forgot = await forgotPOST(req('/api/auth/forgot-password', { method: 'POST', body: { email: FIX.userA.email } }))
    const { resetToken } = (await jsonBody(forgot)) as { resetToken: string }

    const [r1, r2] = await Promise.all([
      resetPOST(req('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'Concurrente-1' } })),
      resetPOST(req('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'Concurrente-2' } })),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 400]) // uno consume; el otro pierde
    // Exactamente un cambio de contraseña aplicado (la clave es UNA de las dos)
    const user = await db.user.findUnique({ where: { id: FIX.userA.id } })
    const tryPw = async (pw: string) => {
      const res = await loginPOST(req('/api/auth/login', { method: 'POST', body: { email: FIX.userA.email, password: pw } }))
      return res.status
    }
    const outcomes = await Promise.all([tryPw('Concurrente-1'), tryPw('Concurrente-2')])
    expect(outcomes.filter((s) => s === 200)).toHaveLength(1)
  })
})

describe('ciclo de vida — rol y estado', () => {
  it('cambiar el rol revoca el JWT anterior (el claim role del token viejo no vale)', async () => {
    const alive = await clientsGET(req('/api/clients', { token: B() }))
    expect(alive.status).toBe(200)
    await teamPUT(req('/api/team/' + FIX.userB.id, { method: 'PUT', token: ownerBToken, body: { role: 'admin' } }), routeParams(FIX.userB.id))
    // El token viejo (tv=0, role=member) muere aunque el usuario siga activo
    expect((await clientsGET(req('/api/clients', { token: B() }))).status).toBe(401)
  })

  it('login rechaza a un usuario desactivado (no puede re-adquirir sesión)', async () => {
    await db.user.update({ where: { id: FIX.userB.id }, data: { isActive: false } })
    // userB del seed tiene passwordHash sintético; el login real devolvería 401 por
    // credenciales — para el caso "desactivado" firmamos la verificación con un
    // usuario con contraseña conocida creado por el flujo de reset.
    const forgot = await forgotPOST(req('/api/auth/forgot-password', { method: 'POST', body: { email: FIX.userA.email } }))
    const { resetToken } = (await jsonBody(forgot)) as { resetToken: string }
    await resetPOST(req('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'Login-Check-2026' } }))
    await db.user.update({ where: { id: FIX.userA.id }, data: { isActive: false } })
    const res = await loginPOST(req('/api/auth/login', { method: 'POST', body: { email: FIX.userA.email, password: 'Login-Check-2026' } }))
    expect(res.status).toBe(403)
  })
})
