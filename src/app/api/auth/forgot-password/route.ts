import type { NextRequest } from 'next/server'
import { randomBytes, createHash } from 'crypto'
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
 *
 * Reparación integral B3: el token (32 bytes aleatorios = 64 hex) se guarda
 * HASHEADO (sha256) en BD. Un atacante con copia de la BD no puede usar los
 * resetToken almacenados: en claro solo existe en el email entregado.
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
      const plain = randomBytes(32).toString('hex') // ≥32 bytes aleatorios (B3)
      const hashed = createHash('sha256').update(plain).digest('hex')
      await db.user.update({
        where: { id: user.id },
        data: {
          resetToken: hashed,
          resetTokenExp: new Date(Date.now() + 3_600_000),
        },
      })
    }

    return json({
      message: 'Si el email está registrado, recibirás instrucciones para restablecer tu contraseña.',
    })
  })
}
