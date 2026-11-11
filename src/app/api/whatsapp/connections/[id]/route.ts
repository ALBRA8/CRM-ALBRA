/**
 * GET    /api/whatsapp/connections/[id] — detalle de UNA conexión de la organización.
 * DELETE /api/whatsapp/connections/[id] — desconecta la conexión (destruye token cifrado).
 *
 * AISLAMIENTO (decisión #8): la búsqueda es SIEMPRE (id, organizationId de la
 * sesión). Una conexión de otra organización responde 404 sin revelar nada.
 * La desconexión de una conexión no afecta a las demás (punto 9).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, json } from '../../../_lib/shared'
import { requireAuth, HttpError } from '@/lib/auth'
import { disconnectConnection } from '@/lib/wa-connections'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const { id } = await ctx.params
    const connection = await db.whatsAppConnection.findFirst({
      where: { id, organizationId: auth.orgId },
      select: {
        id: true, wabaId: true, phoneNumberId: true, phoneNumber: true, displayName: true,
        status: true, statusDetail: true, source: true, tokenExpiresAt: true,
        lastVerifiedAt: true, lastErrorAt: true, createdAt: true, updatedAt: true,
        events: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, type: true, detail: true, createdAt: true } },
      },
    })
    if (!connection) throw new HttpError(404, 'Conexión no encontrada')
    return json(connection)
  })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    if (!auth.isAdmin) throw new HttpError(403, 'Solo un administrador puede desconectar números de WhatsApp')
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({})) as { revoked?: boolean }
    const result = await disconnectConnection(auth.orgId, id, { revoked: body.revoked === true })
    if (!result.ok) throw new HttpError(404, result.message)
    return json({ ok: true, status: result.status })
  })
}
