import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { getIntegration, parseInstagramState, encodeInstagramState } from '@/lib/integrations'
import { maskSecret } from '@/lib/crypto'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET    /api/instagram/config — { configured, config: { igAccountId, accessToken(enmascarado), webhookVerifyToken, hasWebhookSecret, isActive, hasAccessToken } }
 * PUT    /api/instagram/config — (admin) guarda token/verifyToken/appSecret cifrados (AES-256-GCM)
 * DELETE /api/instagram/config — (admin) desconecta
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const state = parseInstagramState(integration.instagramTokenEnc)
    return json({
      configured: !!(state.token || integration.instagramAccountId),
      config: {
        igAccountId: integration.instagramAccountId || '',
        accessToken: maskSecret(state.token),
        webhookVerifyToken: state.webhookVerifyToken || '',
        hasWebhookSecret: !!state.webhookSecret,
        isActive: integration.enableInstagram && !!state.token,
        hasAccessToken: !!state.token,
      },
    })
  })
}

interface InstagramConfigBody {
  igAccountId?: string
  accessToken?: string
  webhookVerifyToken?: string
  webhookSecret?: string
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as InstagramConfigBody
    const integration = await getIntegration(auth.orgId)
    const current = parseInstagramState(integration.instagramTokenEnc)

    const next = { ...current }
    if (body.accessToken !== undefined && body.accessToken !== null && !String(body.accessToken).startsWith('••••')) {
      next.token = String(body.accessToken).trim() || undefined
    }
    if (body.webhookVerifyToken !== undefined) next.webhookVerifyToken = String(body.webhookVerifyToken).trim() || undefined
    if (body.webhookSecret !== undefined && body.webhookSecret !== '') next.webhookSecret = String(body.webhookSecret).trim()

    await db.integration.update({
      where: { organizationId: auth.orgId },
      data: {
        instagramTokenEnc: encodeInstagramState(next),
        ...(body.igAccountId !== undefined ? { instagramAccountId: String(body.igAccountId).trim() || null } : {}),
        enableInstagram: !!next.token,
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'instagram', igAccountId: body.igAccountId || integration.instagramAccountId, tokenMasked: maskSecret(next.token) },
    })

    return json({
      success: true,
      configured: !!(next.token || body.igAccountId),
      config: {
        igAccountId: body.igAccountId || integration.instagramAccountId || '',
        hasAccessToken: !!next.token,
        hasWebhookSecret: !!next.webhookSecret,
        isActive: !!next.token,
      },
    })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    await db.integration.update({
      where: { organizationId: auth.orgId },
      data: { instagramTokenEnc: null, instagramAccountId: null, enableInstagram: false },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'instagram', disconnected: true },
    })
    return json({ success: true, configured: false })
  })
}
