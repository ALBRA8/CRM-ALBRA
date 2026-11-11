import type { NextRequest } from 'next/server'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { handle, json, readBody } from '../../../_lib/shared'
import { encryptSecret } from '@/lib/crypto'
import { generateTotpSecret, provisioningUri } from '@/lib/two-factor'

/**
 * POST /api/auth/2fa/setup — (OLEADA 2) inicia el enrolamiento TOTP del
 * usuario autenticado.
 *
 * Genera un secreto de 160 bits, lo guarda CIFRADO (AES-256-GCM) con
 * twoFactorEnabled=false, y devuelve UNA única vez:
 *   - secret:      base32 (para configurar la app manualmente);
 *   - otpauthUri:  URI estándar otpauth://totp/...;
 *   - qrDataUrl:   imagen PNG data-URL lista para <img src=...>.
 *
 * La activación REAL ocurre en POST /api/auth/2fa/enable con un código válido:
 * mientras tanto el login sigue funcionando con solo contraseña (sin bloquear
 * al usuario por un enrolamiento a medias).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    await readBody(req) // sin cuerpo requerido; valida tamaño si viene

    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { twoFactorEnabled: true, email: true },
    })
    if (!user) throw new HttpError(404, 'Usuario no encontrado')
    if (user.twoFactorEnabled) {
      throw new HttpError(409, 'El segundo factor ya está activo. Desactívalo antes de re-configurar.')
    }

    const secret = generateTotpSecret()
    const enc = encryptSecret(secret)
    if (!enc) throw new HttpError(500, 'Cifrado no disponible (APP_ENCRYPTION_KEY/APP_SECRET).')

    await db.user.update({
      where: { id: auth.userId },
      data: { twoFactorSecret: enc, twoFactorEnabled: false, twoFactorRecovery: null, twoFactorLastCounter: null },
    })

    const otpauthUri = provisioningUri(user.email, secret)
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 })

    // ÚNICA vez que el secreto sale del servidor en claro.
    return json({ secret, otpauthUri, qrDataUrl })
  })
}
