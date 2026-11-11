import type { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword, HttpError } from '@/lib/auth'
import { handle, json, readBody, requireFields, str } from '../../_lib/shared'
import { auditAndTimeline } from '@/lib/api-helpers'
import { bumpTokenVersion } from '@/lib/session-invalidation'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'

/** Política mínima de contraseñas (segunda reparación — orden §2.D):
 *  longitud ≥ 8. La anterior (6) quedaba por debajo de todo estándar razonable. */
export const MIN_PASSWORD_LENGTH = 8

/** POST /api/auth/reset-password — valida token+exp y actualiza la contraseña. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['token', 'password'])
    const token = str(body.token) as string
    const password = str(body.password) as string
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
    }

    // Anti abuso del endpoint (reparación integral): límite persistente en BD,
    // efectivo entre instancias y entre reinicios (segunda reparación §2.C).
    if (!(await dbRateLimit(`reset:${clientIp(req)}`, 10, 3_600_000)).ok) {
      throw new HttpError(429, 'Demasiados intentos. Inténtalo más tarde.')
    }

    // El token se compara por SHA-256 (nunca se almacena en claro).
    const tokenHash = createHash('sha256').update(token).digest('hex')

    // (segunda reparación — orden §2.D) CONSUMO ATÓMICO del token de recuperación:
    // un único UPDATE condicionado valida token+expiración y lo anula en la misma
    // operación. Dos peticiones concurrentes con el mismo token: solo UNA gana
    // (count === 1); la otra recibe "token inválido". Imposible el doble uso.
    // El primer findFirst es solo para el mensaje de auditoría; la autoridad de
    // consumo es el updateMany, y su éxito implica que el token era válido.
    const candidate = await db.user.findFirst({ where: { resetToken: tokenHash } })
    if (!candidate) throw new HttpError(400, 'Token inválido o expirado')

    const consumed = await db.user.updateMany({
      where: {
        id: candidate.id,
        resetToken: tokenHash,
        resetTokenExp: { gt: new Date() },
      },
      data: { passwordHash: hashPassword(password), resetToken: null, resetTokenExp: null, tokenVersion: { increment: 1 } },
    })
    if (consumed.count !== 1) {
      // Ya consumido (uso concurrente) o expirado: jamás se acepta dos veces.
      throw new HttpError(400, 'Token inválido o expirado')
    }

    // La revocación de sesiones ya quedó aplicada por el incremento de
    // tokenVersion dentro del propio UPDATE atómico: ningún JWT anterior
    // sobrevive al cambio de contraseña, en esta instancia ni en otra.
    await auditAndTimeline({ orgId: candidate.organizationId, userId: candidate.id, action: 'updated', entity: 'user', entityId: candidate.id, details: { name: candidate.name, field: 'password' } })

    return json({ message: 'Contraseña actualizada correctamente' })
  })
}
