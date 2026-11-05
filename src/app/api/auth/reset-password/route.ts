import type { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword, HttpError } from '@/lib/auth'
import { handle, json, readBody, requireFields, str } from '../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'
import { rateLimit, rateLimited, clientIp } from '@/lib/rate-limit'
import { bumpTokenVersionForUser } from '@/lib/session-version'

/**
 * POST /api/auth/reset-password — valida token+exp y actualiza la contraseña.
 *
 * Reparación integral B2: rate limit 10/15min por IP (el endpoint recibe
 * tokens secretos: acotar reintentos online).
 * Reparación integral B3: el token se busca POR SU SHA256 (en BD solo vive el
 * hash) y es de un solo uso (resetToken=null al consumirlo; reutilizar → 400).
 * Al éxito se incrementa tokenVersion (B4): cualquier sesión abierta con la
 * contraseña antigua queda revocada.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const rl = rateLimit(`reset-pw:${clientIp(req)}`, 10, 15 * 60_000)
    if (!rl.ok) return rateLimited(rl)

    const body = await readBody(req)
    requireFields(body, ['token', 'password'])
    const token = str(body.token) as string
    const password = str(body.password) as string
    if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres')

    const hashed = createHash('sha256').update(token).digest('hex')
    const user = await db.user.findFirst({ where: { resetToken: hashed } })
    if (!user || !user.resetTokenExp || user.resetTokenExp.getTime() < Date.now()) {
      throw new HttpError(400, 'Token inválido o expirado')
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(password),
        resetToken: null, // un solo uso
        resetTokenExp: null,
        tokenVersion: { increment: 1 }, // B4: revoca sesiones previas
      },
      select: { id: true, organizationId: true, name: true, tokenVersion: true },
    })
    bumpTokenVersionForUser(updated.id, updated.tokenVersion)

    await auditAndTimeline({ orgId: updated.organizationId, userId: updated.id, action: 'updated', entity: 'user', entityId: updated.id, details: { name: updated.name, field: 'password' } })

    return json({ message: 'Contraseña actualizada correctamente' })
  })
}
