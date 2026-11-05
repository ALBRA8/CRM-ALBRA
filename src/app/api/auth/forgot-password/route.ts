import type { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { handle, json, readBody, requireFields, str } from '../../_lib/shared'
import { rateLimit, rateLimited, clientIp } from '@/lib/rate-limit'

/**
 * POST /api/auth/forgot-password — genera resetToken con 1h de validez.
 *
 * Reparación integral B2:
 * - Rate limit 3/15min por IP+email (anti-abuso del mecanismo).
 * - Respuesta SIEMPRE genérica 200 e IDÉNTICA exista o no el email
 *   (anti-enumeración; se eliminó el token en claro que antes se devolvía
 *   en desarrollo: la forma de la respuesta ya no depende de la existencia
 *   de la cuenta ni del entorno).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['email'])
    const email = (str(body.email) as string).toLowerCase()

    const rl = rateLimit(`forgot:${clientIp(req)}:${email}`, 3, 15 * 60_000)
    if (!rl.ok) return rateLimited(rl)

    const user = await db.user.findUnique({ where: { email } })
    if (user && user.isActive) {
      // 32 bytes aleatorios (≥32 que exigirá B3). B3 lo guardará hasheado.
      await db.user.update({
        where: { id: user.id },
        data: {
          resetToken: randomBytes(32).toString('hex'),
          resetTokenExp: new Date(Date.now() + 3_600_000),
        },
      })
    }

    return json({
      message: 'Si el email está registrado, recibirás instrucciones para restablecer tu contraseña.',
    })
  })
}
