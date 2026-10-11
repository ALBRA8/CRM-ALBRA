import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, HttpError } from '@/lib/auth'
import { handle, json } from '../../../_lib/shared'

/**
 * DELETE /api/settings/api-keys/:id — revoca la clave (revokedAt = now).
 * No se borra la fila: queda como registro de auditoría y deja de funcionar
 * al instante en el próximo request del Servidor MCP.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const { id } = await params
    const existing = await db.apiKey.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, revokedAt: true } })
    if (!existing) throw new HttpError(404, 'Clave no encontrada')
    if (!existing.revokedAt) {
      await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })
    }
    return json({ revoked: true })
  })
}
