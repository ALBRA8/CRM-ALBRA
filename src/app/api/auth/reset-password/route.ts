import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, HttpError } from '@/lib/auth'
import { handle, json, readBody, requireFields, str } from '../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'

/** POST /api/auth/reset-password — valida token+exp y actualiza la contraseña. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['token', 'password'])
    const token = str(body.token) as string
    const password = str(body.password) as string
    if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres')

    const user = await db.user.findFirst({ where: { resetToken: token } })
    if (!user || !user.resetTokenExp || user.resetTokenExp.getTime() < Date.now()) {
      throw new HttpError(400, 'Token inválido o expirado')
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(password), resetToken: null, resetTokenExp: null },
    })
    await auditAndTimeline({ orgId: user.organizationId, userId: user.id, action: 'updated', entity: 'user', entityId: user.id, details: { name: user.name, field: 'password' } })

    return json({ message: 'Contraseña actualizada correctamente' })
  })
}
