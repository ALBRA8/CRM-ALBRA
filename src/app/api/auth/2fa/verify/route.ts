import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyMfaTicket, signToken, HttpError } from '@/lib/auth'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'
import { decryptSecret } from '@/lib/crypto'
import { verifyTotp, consumeRecoveryCode } from '@/lib/two-factor'

/**
 * POST /api/auth/2fa/verify — (OLEADA 2) canjea un ticket MFA por una sesión.
 *
 * Requiere: { mfaToken, code } donde code es el código TOTP de 6 dígitos de la
 * app autenticadora, O un código de recuperación (un solo uso).
 *
 * Seguridad:
 *  - El ticket MFA (claim mfa:true, 5 min) NO autentica ninguna otra operación.
 *  - Anti-replay: un código TOTP consumido (twoFactorLastCounter) NO vuelve a
 *    servir, ni siquiera dentro de su ventana de 30 s.
 *  - Rate limiting PERSISTENTE por IP y por cuenta: fuerza bruta sobre 10^6
 *    imposible a ese ritmo (8 intentos / 5 min por cuenta, 20/min por IP).
 *  - Mensaje de error genérico (no distingue código malo de ticket vencido).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['mfaToken', 'code'])

    const mfaToken = str(body.mfaToken) as string
    const code = str(body.code) as string
    const ip = clientIp(req)

    // Verificación del ticket ANTES del rate limit por cuenta: el límite por
    // cuenta necesita el userId del ticket.
    const ticket = verifyMfaTicket(mfaToken)
    if (!ticket) {
      // Rate limit por IP también en el camino sin ticket (barrido de códigos).
      await dbRateLimit(`2fa:ip:${ip}`, 20, 60_000)
      throw new HttpError(401, 'Código inválido o sesión expirada. Inicia sesión de nuevo.')
    }

    const [perIp, perAccount] = await Promise.all([
      dbRateLimit(`2fa:ip:${ip}`, 20, 60_000),
      dbRateLimit(`2fa:acct:${ticket.userId}`, 8, 300_000),
    ])
    if (!perIp.ok || !perAccount.ok) {
      throw new HttpError(429, 'Demasiados intentos. Inténtalo más tarde.')
    }

    const user = await db.user.findUnique({ where: { id: ticket.userId } })
    if (!user || !user.isActive || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new HttpError(401, 'Código inválido o sesión expirada. Inicia sesión de nuevo.')
    }
    if (ticket.orgId !== user.organizationId) {
      // El ticket nunca puede "viajar" entre organizaciones (multi-tenant estricto).
      throw new HttpError(401, 'Código inválido o sesión expirada. Inicia sesión de nuevo.')
    }

    const secret = decryptSecret(user.twoFactorSecret)
    if (!secret) throw new HttpError(500, 'No se pudo verificar el segundo factor (configuración de cifrado).')

    // ---- 1) Intento TOTP con anti-replay ----
    const totp = verifyTotp(secret, code, { notBeforeCounter: user.twoFactorLastCounter ?? undefined })
    if (totp.ok) {
      await db.user.update({
        where: { id: user.id },
        data: { twoFactorLastCounter: totp.counter },
      })

      const token = signToken({
        userId: user.id,
        orgId: user.organizationId,
        role: user.role,
        email: user.email,
        tv: user.tokenVersion,
      })
      await auditAndTimeline({
        orgId: user.organizationId,
        userId: user.id,
        action: 'login',
        entity: 'user',
        entityId: user.id,
        details: { name: user.name, twoFactor: 'totp' },
      })
      return jsonWithSession({
        token,
        user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
      }, token)
    }

    // ---- 2) Intento como código de recuperación (un solo uso) ----
    const consumed = consumeRecoveryCode(user.twoFactorRecovery, code)
    if (consumed) {
      await db.user.update({
        where: { id: user.id },
        data: { twoFactorRecovery: JSON.stringify(consumed.remaining) },
      })
      const token = signToken({
        userId: user.id,
        orgId: user.organizationId,
        role: user.role,
        email: user.email,
        tv: user.tokenVersion,
      })
      await auditAndTimeline({
        orgId: user.organizationId,
        userId: user.id,
        action: 'login',
        entity: 'user',
        entityId: user.id,
        details: { name: user.name, twoFactor: 'recovery', remainingRecoveryCodes: consumed.remaining.length },
      })
      return jsonWithSession({
        token,
        user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
      }, token)
    }

    // Sin éxito: mismo mensaje genérico para código malo, replay o recovery agotado.
    throw new HttpError(401, 'Código inválido o sesión expirada. Inicia sesión de nuevo.')
  })
}

