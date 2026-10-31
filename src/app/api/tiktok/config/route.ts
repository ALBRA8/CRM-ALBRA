import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, json, auditAndTimeline } from '@/lib/api-helpers'
import { getIntegration, parseTikTokState, encodeTikTokState } from '@/lib/integrations'
import { maskSecret } from '@/lib/crypto'

/**
 * GET    /api/tiktok/config — { configured, config: { openId, displayName, accessToken(enmascarado), appKey, hasAppSecret, webhookVerifyToken, extraScopes, sendEndpoint, isActive, hasAccessToken } }
 * PUT    /api/tiktok/config — (admin) guarda appKey/appSecret/verifyToken/scopes/sendEndpoint cifrados (AES-256-GCM)
 * DELETE /api/tiktok/config — (admin) desconecta
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const state = parseTikTokState(integration.tiktokTokenEnc)
    return json({
      configured: !!(state.accessToken || state.appKey),
      config: {
        openId: state.openId || '',
        displayName: state.displayName || '',
        accessToken: maskSecret(state.accessToken),
        appKey: state.appKey || '',
        hasAppSecret: !!state.appSecret,
        webhookVerifyToken: state.webhookVerifyToken || '',
        extraScopes: state.extraScopes || '',
        sendEndpoint: state.sendEndpoint || '',
        isActive: integration.enableTikTok && !!state.accessToken,
        hasAccessToken: !!state.accessToken,
      },
    })
  })
}

interface TikTokConfigBody {
  appKey?: string
  appSecret?: string
  webhookVerifyToken?: string
  extraScopes?: string
  sendEndpoint?: string
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as TikTokConfigBody
    const integration = await getIntegration(auth.orgId)
    const current = parseTikTokState(integration.tiktokTokenEnc)

    const next = { ...current }
    if (body.appKey !== undefined) next.appKey = String(body.appKey).trim() || undefined
    if (body.appSecret !== undefined && body.appSecret !== '' && !String(body.appSecret).startsWith('••••')) {
      next.appSecret = String(body.appSecret).trim()
    }
    if (body.webhookVerifyToken !== undefined) next.webhookVerifyToken = String(body.webhookVerifyToken).trim() || undefined
    if (body.extraScopes !== undefined) next.extraScopes = String(body.extraScopes).trim() || undefined
    if (body.sendEndpoint !== undefined) next.sendEndpoint = String(body.sendEndpoint).trim() || undefined

    await db.integration.update({
      where: { organizationId: auth.orgId },
      data: {
        tiktokTokenEnc: encodeTikTokState(next),
        enableTikTok: !!next.accessToken,
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'tiktok', appKey: next.appKey || null, secretMasked: maskSecret(next.appSecret) },
    })

    return json({ success: true, configured: !!(next.accessToken || next.appKey) })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    await db.integration.update({
      where: { organizationId: auth.orgId },
      data: { tiktokTokenEnc: null, enableTikTok: false },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'tiktok', disconnected: true },
    })
    return json({ success: true, configured: false })
  })
}
