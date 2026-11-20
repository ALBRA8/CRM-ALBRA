import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle } from '@/lib/api-helpers'
import { decryptSecret } from '@/lib/crypto'
import { encodeInstagramState, getIntegration, parseInstagramState } from '@/lib/integrations'

/** Lista las cuentas Instagram conectadas al tenant autenticado, sin credenciales. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const connections = await db.channelConnection.findMany({
      where: { organizationId: auth.orgId, channel: 'instagram', provider: 'meta_graph' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        externalAccountId: true,
        displayName: true,
        status: true,
        metadata: true,
        lastVerifiedAt: true,
      },
    })
    // (UNIFICACIÓN 2026-11-21) La cuenta seleccionada se resuelve de la propia
    // fila canónica (la conexión conectada con blob de credenciales vigente).
    return NextResponse.json({
      selectedConnectionId: connections.find((connection) => connection.status === 'connected')?.id || null,
      connections: connections.map((connection) => {
        let metadata: { username?: string | null; pageName?: string | null } = {}
        try { metadata = JSON.parse(connection.metadata || '{}') } catch { /* metadata no confiable: omitir */ }
        return {
          id: connection.id,
          accountId: connection.externalAccountId,
          displayName: connection.displayName,
          username: metadata.username || null,
          pageName: metadata.pageName || null,
          status: connection.status,
          lastVerifiedAt: connection.lastVerifiedAt,
        }
      }),
    })
  })
}

/** Selecciona la cuenta Instagram activa para compatibilidad con el flujo legacy. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const body = await req.json().catch(() => ({})) as { connectionId?: string }
    if (!body.connectionId || typeof body.connectionId !== 'string') {
      return NextResponse.json({ error: 'connectionId requerido' }, { status: 400 })
    }

    const connection = await db.channelConnection.findFirst({
      where: {
        id: body.connectionId,
        organizationId: auth.orgId,
        channel: 'instagram',
        provider: 'meta_graph',
        status: 'connected',
      },
      select: { id: true, externalAccountId: true, credentialsEnc: true },
    })
    if (!connection) return NextResponse.json({ error: 'Conexión no encontrada' }, { status: 404 })

    const plaintext = decryptSecret(connection.credentialsEnc)
    if (!plaintext) return NextResponse.json({ error: 'Credenciales no disponibles; reconecta la cuenta' }, { status: 409 })

    let credentials: { accessToken?: string; appSecret?: string; webhookVerifyToken?: string | null }
    try { credentials = JSON.parse(plaintext) } catch {
      return NextResponse.json({ error: 'Credenciales no válidas; reconecta la cuenta' }, { status: 409 })
    }
    if (!credentials.accessToken) return NextResponse.json({ error: 'Token no disponible; reconecta la cuenta' }, { status: 409 })

    // (UNIFICACIÓN 2026-11-21) El blob de credenciales de Instagram vive en la
    // propia ChannelConnection: se actualiza credentialsEnc de la fila elegida.
    const current = parseInstagramState(connection.credentialsEnc)
    const next = encodeInstagramState({ ...current, token: credentials.accessToken })
    if (!next) return NextResponse.json({ error: 'Cifrado no disponible' }, { status: 500 })
    await db.channelConnection.update({
      where: { id: connection.id },
      data: { credentialsEnc: next, status: 'connected', updatedAt: new Date() },
    })
    return NextResponse.json({ success: true, selectedConnectionId: connection.id })
  })
}
