import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, signToken, HttpError } from '@/lib/auth'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'
import { rateLimit, rateLimited, clientIp } from '@/lib/rate-limit'

/**
 * POST /api/auth/login — verifica credenciales y devuelve { token, user }.
 *
 * Reparación integral B2:
 * - Rate limiting por IP (10/min) y por email (5/15min) → 429 genérico
 *   (anti fuerza-bruta; el bucket por email solo consume con intentos FALLIDOS
 *   para no bloquear a un usuario legítimo que inicia sesión varias veces).
 * - El mensaje de error NO distingue usuario inexistente de contraseña
 *   incorrecta (anti-enumeración): siempre 401 'Credenciales inválidas'.
 */

const LOGIN_IP_LIMIT = 10
const LOGIN_IP_WINDOW_MS = 60_000
const LOGIN_EMAIL_LIMIT = 5
const LOGIN_EMAIL_WINDOW_MS = 15 * 60_000

export async function POST(req: NextRequest) {
  return handle(async () => {
    const ip = clientIp(req)
    const ipCheck = rateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS)
    if (!ipCheck.ok) return rateLimited(ipCheck)

    const body = await readBody(req)
    requireFields(body, ['email', 'password'])

    const email = (str(body.email) as string).toLowerCase()
    const password = str(body.password) as string

    // Bucket por email: se consume SOLO en fallos de credenciales (abajo),
    // de modo que el límite refleja intentos de adivinación, no uso legítimo.
    const emailKey = `login:email:${email}`

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const failed = rateLimit(emailKey, LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW_MS)
      if (!failed.ok) return rateLimited(failed)
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
