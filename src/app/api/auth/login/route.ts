import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, signToken, signMfaTicket, HttpError } from '@/lib/auth'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'

/**
 * POST /api/auth/login — verifica credenciales y devuelve { token, user }.
 *
 * (OLEADA 2) Si el usuario tiene 2FA (twoFactorEnabled), NO emite sesión:
 * devuelve { mfaRequired: true, mfaToken } — un ticket provisional de 5 min
 * que se canjea por la sesión en POST /api/auth/2fa/verify presentando el
 * código TOTP (o un código de recuperación). Sin segundo factor no hay sesión.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['email', 'password'])

    const email = (str(body.email) as string).toLowerCase()
    const password = str(body.password) as string

    // Anti fuerza bruta (segunda reparación §2.C): límites PERSISTENTES en BD
    // (ventana deslizante por IP+cuenta 10/min y por IP 30/min), efectivos entre
    // instancias y reinicios. Sin revelar cuál de las dos falló.
    const ip = clientIp(req)
    const perAccount = await dbRateLimit(`login:acct:${ip}:${email}`, 10, 60_000)
    const perIp = await dbRateLimit(`login:ip:${ip}`, 30, 60_000)
    if (!perAccount.ok || !perIp.ok) {
      throw new HttpError(429, 'Demasiados intentos de inicio de sesión. Inténtalo más tarde.')
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Credenciales inválidas')
    }
    if (!user.isActive) throw new HttpError(403, 'Usuario desactivado. Contacta al administrador.')
    const org = await db.organization.findUnique({ where: { id: user.organizationId }, select: { isActive: true } })
    if (!org || !org.isActive) throw new HttpError(403, 'La organización no está activa')

    // (OLEADA 2) 2FA activo → ticket MFA provisional; la sesión solo se emite
    // tras el segundo factor. El ticket NO sirve para ninguna otra operación.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const mfaToken = signMfaTicket({
        userId: user.id,
        orgId: user.organizationId,
        role: user.role,
        email: user.email,
      })
      return NextResponse.json({ mfaRequired: true, mfaToken })
    }

    // (segunda reparación) El JWT nace con la tokenVersion vigente del usuario:
    // la guarda async la coteja contra la BD en cada petición.
    const token = signToken({ userId: user.id, orgId: user.organizationId, role: user.role, email: user.email, tv: user.tokenVersion })
    await auditAndTimeline({ orgId: user.organizationId, userId: user.id, action: 'login', entity: 'user', entityId: user.id, details: { name: user.name } })

    // Cookie httpOnly además del token en el body (modo dual: la cookie
    // persiste la sesión tras F5 sin exponer el JWT a JavaScript)
    return jsonWithSession({
      token,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
