import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { maskSecret } from '@/lib/crypto'
import { getGoogleClientConfig, getGoogleRefreshToken, saveGoogleClientConfig, clearGoogleConnection, GOOGLE_SCOPES } from '@/lib/google'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET    /api/google/config — estado de conexión sin secretos
 * PUT    /api/google/config — (admin) guarda clientId/clientSecret cifrados
 * DELETE /api/google/config — (admin) borra la configuración completa
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const client = await getGoogleClientConfig(auth.orgId)
    const refreshToken = await getGoogleRefreshToken(auth.orgId)
    const integration = await db.integration.findUnique({ where: { organizationId: auth.orgId }, select: { enableGoogle: true } })
    return json({
      configured: !!client,
      connected: !!refreshToken,
      config: client
        ? {
            clientId: client.clientId,
            clientIdMasked: maskSecret(client.clientId),
            scopes: GOOGLE_SCOPES,
          }
        : null,
      enableGoogle: integration?.enableGoogle ?? false,
    })
  })
}

interface GoogleConfigBody {
  clientId?: string
  clientSecret?: string
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as GoogleConfigBody
    const clientId = String(body.clientId || '').trim()
    const clientSecret = String(body.clientSecret || '').trim()
    if (!clientId || !clientSecret) {
      return json({ error: 'clientId y clientSecret son requeridos' }, { status: 400 })
    }
    await saveGoogleClientConfig(auth.orgId, clientId, clientSecret)
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'google', clientId: maskSecret(clientId) },
    })
    return json({ success: true, configured: true, connected: !!(await getGoogleRefreshToken(auth.orgId)), scopes: GOOGLE_SCOPES })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    await db.integration.updateMany({ where: { organizationId: auth.orgId }, data: { googleClientJsonEnc: null } })
    await clearGoogleConnection(auth.orgId)
    await auditAndTimeline({ orgId: auth.orgId, userId: auth.userId, action: 'updated', entity: 'integration', details: { provider: 'google', cleared: true } })
    return json({ success: true, configured: false, connected: false })
  })
}
