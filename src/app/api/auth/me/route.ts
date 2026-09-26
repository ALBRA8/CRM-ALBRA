import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '../../_lib/shared'

/** GET /api/auth/me — datos del usuario de la sesión (sin passwordHash). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const user = await db.user.findFirst({
      where: { id: auth.userId, organizationId: auth.orgId, isActive: true },
      select: { id: true, name: true, email: true, company: true, phone: true, role: true, avatar: true, organizationId: true },
    })
    if (!user) {
      return json({ error: 'Sesión inválida' }, { status: 401 })
    }
    return json({ user })
  })
}
