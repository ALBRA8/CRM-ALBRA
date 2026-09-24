import type { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { handle, json, readBody, requireFields, str } from '../../_lib/shared'

/**
 * POST /api/auth/forgot-password — genera resetToken con 1h de validez.
 * Respuesta genérica para evitar enumeración de emails. En desarrollo se
 * devuelve el token para poder probar el flujo sin SMTP configurado.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['email'])
    const email = (str(body.email) as string).toLowerCase()

    const user = await db.user.findUnique({ where: { email } })
    let devToken: string | undefined
    if (user && user.isActive) {
      devToken = randomBytes(24).toString('hex')
      await db.user.update({
        where: { id: user.id },
        data: { resetToken: devToken, resetTokenExp: new Date(Date.now() + 3_600_000) },
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
