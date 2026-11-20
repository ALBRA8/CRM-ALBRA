/**
 * GET    /api/whatsapp/connections/[id] — detalle de UNA conexión de la organización.
 * DELETE /api/whatsapp/connections/[id] — desconecta la conexión (destruye token cifrado).
 *
 * AISLAMIENTO (decisión #8): la búsqueda es SIEMPRE (id, organizationId de la
 * sesión). Una conexión de otra organización responde 404 sin revelar nada.
 * La desconexión de una conexión no afecta a las demás (punto 9).
 *
 * (UNIFICACIÓN 2026-11-21) La fuente es ChannelConnection (provider='meta_cloud').
 * La respuesta conserva la forma que consumía el panel cuando la fuente era la
 * tabla WhatsAppConnection: phoneNumberId/phoneNumber/wabaId/statusDetail/
 * source se resuelven de externalAccountId + metadata.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, json } from '../../../_lib/shared'
import { requireAuth, HttpError } from '@/lib/auth'
import { disconnectConnection } from '@/lib/wa-connections'

function safeMetadata(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const { id } = await ctx.params
    const connection = await db.channelConnection.findFirst({
      where: { id, organizationId: auth.orgId, channel: 'whatsapp', provider: 'meta_cloud' },
      select: {
        id: true, externalAccountId: true, displayName: true,
        status: true, tokenExpiresAt: true,
        lastVerifiedAt: true, lastErrorAt: true, createdAt: true, updatedAt: true,
        metadata: true,
        events: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, type: true, detail: true, createdAt: true } },
      },
    })
    if (!connection) throw new HttpError(404, 'Conexión no encontrada')
    const meta = safeMetadata(connection.metadata)
    return json({
      id: connection.id,
      wabaId: typeof meta.wabaId === 'string' ? meta.wabaId : null,
      phoneNumberId: connection.externalAccountId,
      phoneNumber: typeof meta.phoneNumber === 'string' ? meta.phoneNumber : connection.externalAccountId,
      displayName: connection.displayName,
      status: connection.status,
      statusDetail: typeof meta.statusDetail === 'string' ? meta.statusDetail : null,
      source: typeof meta.source === 'string' ? meta.source : 'embedded_signup',
      tokenExpiresAt: connection.tokenExpiresAt,
      lastVerifiedAt: connection.lastVerifiedAt,
      lastErrorAt: connection.lastErrorAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      events: connection.events,
    })
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
