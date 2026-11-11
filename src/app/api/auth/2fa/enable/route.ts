import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { handle, json, readBody, requireFields, str } from '../../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'
import { decryptSecret } from '@/lib/crypto'
import { verifyTotp, generateRecoveryCodes, hashRecoveryCode } from '@/lib/two-factor'

/**
 * POST /api/auth/2fa/enable — (OLEADA 2) confirma el enrolamiento TOTP.
 *
 * Requiere { code }: un código TOTP VÁLIDO para el secreto guardado por
 * /api/auth/2fa/setup. Al confirmar:
 *   - twoFactorEnabled = true (desde el PRÓXIMO login el segundo factor es
 *     obligatorio; la sesión actual NO se invalida);
 *   - genera 8 códigos de recuperación de un solo uso: en BD SOLO sus hashes
 *     SHA-256; la lista en claro se devuelve UNA vez al usuario.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['code'])
    const code = str(body.code) as string

    // Fuerza bruta sobre el código imposible a este ritmo (persistente).
    const rl = await dbRateLimit(`2fa:enable:${auth.userId}:${clientIp(req)}`, 10, 60_000)
    if (!rl.ok) throw new HttpError(429, 'Demasiados intentos. Inténtalo más tarde.')

    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true, email: true, organizationId: true },
    })
    if (!user) throw new HttpError(404, 'Usuario no encontrado')
    if (user.twoFactorEnabled) throw new HttpError(409, 'El segundo factor ya está activo.')
    if (!user.twoFactorSecret) throw new HttpError(400, 'Primero inicia la configuración (POST /api/auth/2fa/setup).')

    const secret = decryptSecret(user.twoFactorSecret)
    if (!secret) throw new HttpError(500, 'No se pudo verificar el segundo factor (configuración de cifrado).')

    const v = verifyTotp(secret, code)
    if (!v.ok) throw new HttpError(401, 'Código inválido. Verifica la hora de tu app autenticadora e intenta de nuevo.')

    const recoveryCodes = generateRecoveryCodes()
    await db.user.update({
      where: { id: auth.userId },
      data: {
        twoFactorEnabled: true,
        twoFactorLastCounter: v.counter,
        twoFactorRecovery: JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: '2fa_enabled',
      entity: 'user',
      entityId: auth.userId,
      details: { email: user.email },
    })

    // La lista en claro se muestra UNA sola vez; en BD solo los hashes.
    return json({ enabled: true, recoveryCodes })
  })
}
