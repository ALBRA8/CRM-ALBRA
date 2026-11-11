import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '../../../_lib/shared'

/**
 * GET /api/auth/2fa/status — (OLEADA 2) estado del segundo factor del usuario
 * autenticado (para la pestaña Seguridad de Settings).
 *
 * Nunca expone el secreto ni los códigos: solo el estado y cuántos códigos de
 * recuperación quedan sin usar (los hashes permiten contar, no recuperar).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { twoFactorEnabled: true, twoFactorSecret: true, twoFactorRecovery: true },
    })
    if (!user) return json({ enabled: false, pendingSetup: false, recoveryCodesLeft: 0 })

    let recoveryCodesLeft = 0
    try {
      const parsed = JSON.parse(user.twoFactorRecovery || '[]')
      if (Array.isArray(parsed)) recoveryCodesLeft = parsed.length
    } catch {
      recoveryCodesLeft = 0
    }
    return json({
      enabled: user.twoFactorEnabled,
      // secreto guardado pero aún no confirmado (enrolamiento a medias)
      pendingSetup: !user.twoFactorEnabled && !!user.twoFactorSecret,
      recoveryCodesLeft,
    })
  })
}
