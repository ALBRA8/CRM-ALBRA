import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, signToken, HttpError } from '@/lib/auth'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'

/** POST /api/auth/login — verifica credenciales y devuelve { token, user }. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['email', 'password'])

    const email = (str(body.email) as string).toLowerCase()
    const password = str(body.password) as string

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Credenciales inválidas')
    }
    if (!user.isActive) throw new HttpError(403, 'Usuario desactivado. Contacta al administrador.')
    const org = await db.organization.findUnique({ where: { id: user.organizationId }, select: { isActive: true } })
    if (!org || !org.isActive) throw new HttpError(403, 'La organización no está activa')

    const token = signToken({ userId: user.id, orgId: user.organizationId, role: user.role, email: user.email })
    await auditAndTimeline({ orgId: user.organizationId, userId: user.id, action: 'login', entity: 'user', entityId: user.id, details: { name: user.name } })

    // Cookie httpOnly además del token en el body (modo dual: la cookie
    // persiste la sesión tras F5 sin exponer el JWT a JavaScript)
    return jsonWithSession({
      token,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
