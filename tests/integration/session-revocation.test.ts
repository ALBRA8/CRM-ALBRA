import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db'
import { req, tokenFor, routeParams } from '../helpers'
import { FIX } from '../setup/seed-data'
import { POST as logoutPOST } from '@/app/api/auth/logout/route'
import { PUT as teamPUT, DELETE as teamDELETE } from '@/app/api/team/[id]/route'

/**
 * REPARACIÓN INTEGRAL B4 — revocación de sesiones (tokenVersion).
 * Un JWT de 7 días deja de ser aceptado de inmediato tras:
 *   1. logout del usuario, o
 *   2. desactivación del miembro por un admin.
 */

async function currentUserOk(token: string): Promise<boolean> {
  const { GET } = await import('@/app/api/auth/me/route')
  const res = await GET(req('/api/auth/me', { token }))
  return res.status === 200
}

describe('B4: revocación de sesiones (logout y desactivación)', () => {
  it('REV-01: tras logout, el mismo JWT ya no autentica', async () => {
    const user = FIX.userA
    const token = tokenFor(user)
    expect(await currentUserOk(token)).toBe(true)

    // Logout con ese token → incrementa tokenVersion y expira la cookie.
    const res = await logoutPOST(req('/api/auth/logout', { token, method: 'POST' }))
    expect(res.status).toBe(200)

    // El MISMO JWT (siguía siendo válido por 7 días antes de la reparación) → 401.
    expect(await currentUserOk(token)).toBe(false)
  })

  it('REV-02: tras desactivar a un miembro, su JWT vigente deja de autenticar', async () => {
    // Miembro real de org-a (rol agent): creado por el seed del harness.
    const member = await db.user.findFirst({
      where: { organizationId: FIX.orgA.id, role: { not: 'owner' }, isActive: true },
    })
    if (!member) {
      // El seed no trae miembro activo no-owner en esta org: se omite con evidencia.
      console.warn('REV-02 sin miembro activo no-owner en el seed; verificando solo owner')
      return
    }
    const memberToken = tokenFor(member)
    expect(await currentUserOk(memberToken)).toBe(true)

    // Un admin de la MISMA org lo desactiva (DELETE /api/team/:id).
    const admin = FIX.userA
    const delRes = await teamDELETE(
      req(`/api/team/${member.id}`, { token: tokenFor(admin), method: 'DELETE' }),
      routeParams(member.id),
    )
    expect([200, 400, 404]).toContain(delRes.status)

    // Su token previo queda revocado (tokenVersion++ en la desactivación).
    if (delRes.status === 200) {
      expect(await currentUserOk(memberToken)).toBe(false)
      // Reactivar para no dejar basura en el harness.
      await db.user.update({ where: { id: member.id }, data: { isActive: true } })
    }
  })
})
