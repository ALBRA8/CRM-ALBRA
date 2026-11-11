import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, verifyPassword, HttpError } from '@/lib/auth'
import { handle, json, readBody, requireFields, str } from '../../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'
import { decryptSecret } from '@/lib/crypto'
import { verifyTotp, consumeRecoveryCode } from '@/lib/two-factor'

/**
 * POST /api/auth/2fa/disable — (OLEADA 2) desactiva el segundo factor.
 *
 * Requiere DOS pruebas (defensa en profundidad):
 *   1. { password }:  la contraseña vigente del usuario;
 *   2. { code }:      un código TOTP válido (o código de recuperación no usado)
 *                     — demuestra posesión del factor antes de quitarlo.
 *
 * Con password+code válidos borra secreto, códigos de recuperación y contador
 * anti-replay (una sola escritura). La sesión actual sigue viva (tokenVersion
 * no cambia): la cuenta vuelve a depender solo de la contraseña. Usar un
 * código de recuperación aquí lo consume igualmente (quedan menos para
 * emergencias; la auditoría registra el método usado).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['password', 'code'])
    const password = str(body.password) as string
    const code = str(body.code) as string

    const rl = await dbRateLimit(`2fa:disable:${auth.userId}:${clientIp(req)}`, 10, 60_000)
    if (!rl.ok) throw new HttpError(429, 'Demasiados intentos. Inténtalo más tarde.')

    const user = await db.user.findUnique({ where: { id: auth.userId } })
    if (!user) throw new HttpError(404, 'Usuario no encontrado')
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new HttpError(409, 'El segundo factor no está activo.')
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Contraseña incorrecta')
    }

    const secret = decryptSecret(user.twoFactorSecret)
    if (!secret) throw new HttpError(500, 'No se pudo verificar el segundo factor (configuración de cifrado).')

    // ---- Prueba 2: posesión del factor (TOTP o código de recuperación) ----
    const v = verifyTotp(secret, code, { notBeforeCounter: user.twoFactorLastCounter ?? undefined })
    let method: 'totp' | 'recovery'
    let recoveryCodesLeft: number | undefined
    if (v.ok) {
      method = 'totp'
    } else {
      const consumed = consumeRecoveryCode(user.twoFactorRecovery, code)
      if (!consumed) throw new HttpError(401, 'Código inválido (ni TOTP ni código de recuperación)')
      method = 'recovery'
      recoveryCodesLeft = consumed.remaining.length
    }

    await db.user.update({
      where: { id: auth.userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecovery: null,
        twoFactorLastCounter: null,
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: '2fa_disabled',
      entity: 'user',
      entityId: auth.userId,
      details: { email: user.email, method, recoveryCodesLeft },
    })

    return json({ enabled: false })
  })
}
