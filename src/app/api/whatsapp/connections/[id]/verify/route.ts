/**
 * POST /api/whatsapp/connections/[id]/verify — revalida el token de la conexión
 * contra Graph API (GET /me) y actualiza el estado de la conexión.
 *
 * El token en claro solo existe EN MEMORIA durante la verificación. Si el
 * token fue revocado en Meta, la conexión pasa a `revoked` — SOLO esa
 * conexión (punto 9 de la decisión: la revocación de una cuenta no afecta a
 * las demás empresas ni conexiones).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, json } from '../../../../_lib/shared'
import { requireAuth, HttpError } from '@/lib/auth'
import { decryptSecret } from '@/lib/crypto'
import { inspectTokenIdentity } from '@/lib/meta-oauth'
import { auditEvent } from '@/lib/wa-connections'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const { id } = await ctx.params
    const connection = await db.whatsAppConnection.findFirst({
      where: { id, organizationId: auth.orgId },
    })
    if (!connection) throw new HttpError(404, 'Conexión no encontrada')
    const token = decryptSecret(connection.accessTokenEnc)
    if (!token) {
      await db.whatsAppConnection.update({
        where: { id: connection.id },
        data: { status: 'disconnected', statusDetail: 'Sin material de token: conexión dada de baja' },
      })
      throw new HttpError(409, 'La conexión no tiene token vigente; reconéctala')
    }
    const identity = await inspectTokenIdentity(token)
    if (!identity.ok) {
      await db.whatsAppConnection.update({
        where: { id: connection.id },
        data: { status: 'revoked', statusDetail: `Token rechazado por Meta: ${identity.error}`, lastErrorAt: new Date() },
      })
      await auditEvent(connection.id, auth.orgId, 'revoked', `Verificación falló: ${identity.error}`)
      throw new HttpError(401, `Token revocado o inválido: ${identity.error}`)
    }
    await db.whatsAppConnection.update({
      where: { id: connection.id },
      data: { status: 'connected', lastVerifiedAt: new Date(), statusDetail: 'Token verificado contra Graph API' },
    })
    await auditEvent(connection.id, auth.orgId, 'verified', 'Token verificado contra Graph API')
    return json({ ok: true, status: 'connected', graphIdentity: identity.id })
  })
}
