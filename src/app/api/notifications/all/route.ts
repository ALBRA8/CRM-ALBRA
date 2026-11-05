import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { handle, json } from '../../_lib/shared'

/**
 * DELETE /api/notifications/all — borra todas las notificaciones de la organización.
 *
 * Reparación integral B2: exige permiso admin 'notifications.manage' (antes
 * bastaba sesión de cualquier rol: un agent borraba el tablero del equipo entero).
 */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requirePermission(req, 'notifications.manage')
    const result = await db.notification.deleteMany({ where: { organizationId: auth.orgId } })
    return json({ success: true, deleted: result.count })
  })
}
