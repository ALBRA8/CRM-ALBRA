import type { NextRequest } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { db } from '@/lib/db'
import { handle, json, readBody, requireFields, str } from '../../_lib/shared'
import { HttpError } from '@/lib/auth'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'

/**
 * POST /api/auth/forgot-password — genera resetToken con 1h de validez.
 * Respuesta genérica para evitar enumeración de emails. En desarrollo se
 * devuelve el token para poder probar el flujo sin SMTP configurado.
 * (reparación integral 2026-11-06): el token se guarda SOLO como SHA-256 —
 * una fuga de la BD ya no permite usar los tokens. Rate limit 5/h por IP+email.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['email'])
    const email = (str(body.email) as string).toLowerCase()

    const ip = clientIp(req)
    // (segunda reparación §2.C) límite PERSISTENTE en BD: 5 solicitudes/h por IP+cuenta.
    if (!(await dbRateLimit(`forgot:${ip}:${email}`, 5, 3_600_000)).ok) {
      throw new HttpError(429, 'Demasiadas solicitudes. Inténtalo más tarde.')
    }

    const user = await db.user.findUnique({ where: { email } })
    let devToken: string | undefined
    if (user && user.isActive) {
      devToken = randomBytes(24).toString('hex')
      await db.user.update({
        where: { id: user.id },
        data: {
          resetToken: createHash('sha256').update(devToken).digest('hex'),
          resetTokenExp: new Date(Date.now() + 3_600_000),
        },
      })
    }

    const payload: Record<string, unknown> = {
      message: 'Si el email está registrado, recibirás instrucciones para restablecer tu contraseña.',
    }
    if (process.env.NODE_ENV !== 'production' && devToken) {
      payload.resetToken = devToken
    }
    return json(payload)
  })
}
