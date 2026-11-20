/**
 * POST /api/whatsapp/connections/[id]/verify — revalida el token de la conexión
 * contra Graph API (GET /me) y actualiza el estado de la conexión.
 *
 * El token en claro solo existe EN MEMORIA durante la verificación (se descifra
 * de credentialsEnc de la conexión canónica). Si el token fue revocado en Meta,
 * la conexión pasa a `revoked` — SOLO esa conexión (punto 9 de la decisión: la
 * revocación de una cuenta no afecta a las demás empresas ni conexiones).
 *
 * (UNIFICACIÓN 2026-11-21) La fuente es ChannelConnection (provider='meta_cloud').
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, json } from '../../../../_lib/shared'
import { requireAuth, HttpError } from '@/lib/auth'
import { parseWhatsAppCloudCredentials } from '@/lib/integrations'
import { inspectTokenIdentity } from '@/lib/meta-oauth'
import { auditEvent } from '@/lib/wa-connections'
import { encryptSecret } from '@/lib/crypto'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const { id } = await ctx.params
    const connection = await db.channelConnection.findFirst({
      where: { id, organizationId: auth.orgId, channel: 'whatsapp', provider: 'meta_cloud' },
    })
    if (!connection) throw new HttpError(404, 'Conexión no encontrada')
    const creds = parseWhatsAppCloudCredentials(connection.credentialsEnc)
    const token = creds.accessToken ?? null
    if (!token) {
      await db.channelConnection.update({
        where: { id: connection.id },
        data: { status: 'disconnected', lastErrorAt: new Date() },
      })
      await auditEvent(connection.id, auth.orgId, 'disconnected', 'Sin material de token: conexión dada de baja')
      throw new HttpError(409, 'La conexión no tiene token vigente; reconéctala')
    }
    const identity = await inspectTokenIdentity(token)
    if (!identity.ok) {
      await db.channelConnection.update({
        where: { id: connection.id },
        data: { status: 'revoked', lastErrorAt: new Date() },
      })
      await auditEvent(connection.id, auth.orgId, 'revoked', `Verificación falló: ${identity.error}`)
      throw new HttpError(401, `Token revocado o inválido: ${identity.error}`)
    }
    await db.channelConnection.update({
      where: { id: connection.id },
      data: { status: 'connected', lastVerifiedAt: new Date() },
    })
    await auditEvent(connection.id, auth.orgId, 'verified', 'Token verificado contra Graph API')
    return json({ ok: true, status: 'connected', graphIdentity: identity.id })
  })
}
