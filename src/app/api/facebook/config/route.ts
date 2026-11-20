import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { getIntegration, parseFacebookState, encodeFacebookState, upsertChannelConnection } from '@/lib/integrations'
import { maskSecret, decryptSecret } from '@/lib/crypto'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET    /api/facebook/config — { configured, config: { pageId, pageName, userEmail, pageToken(enmascarado), webhookVerifyToken, hasAppSecret, isActive, hasPageToken } }
 *        pageName/userEmail los llena el OAuth «Conectar mediante Meta» (columnas facebook*).
 * PUT    /api/facebook/config — (admin) guarda pageToken/verifyToken (blob AES-256-GCM en facebookTokenEnc)
 *                               y el App Secret de Meta (AES-256-GCM en metaAppSecretEnc, compartido con Instagram/WhatsApp).
 * DELETE /api/facebook/config — (admin) desconecta Facebook (conserva el App Secret: es de la app de Meta).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const state = parseFacebookState(integration.facebookTokenEnc)
    return json({
      configured: !!(state.pageToken || integration.facebookPageId),
      config: {
        pageId: integration.facebookPageId || '',
        pageName: integration.facebookPageName || '',
        userEmail: integration.facebookUserEmail || '',
        pageToken: maskSecret(state.pageToken),
        webhookVerifyToken: state.webhookVerifyToken || '',
        hasAppSecret: !!integration.metaAppSecretEnc,
        isActive: integration.enableFacebook && !!state.pageToken,
        hasPageToken: !!state.pageToken,
      },
    })
  })
}

interface FacebookConfigBody {
  pageId?: string
  pageToken?: string
  webhookVerifyToken?: string
  appSecret?: string
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as FacebookConfigBody
    const integration = await getIntegration(auth.orgId)
    const current = parseFacebookState(integration.facebookTokenEnc)

    const next = { ...current }
    if (body.pageToken !== undefined && body.pageToken !== null && !String(body.pageToken).startsWith('••••')) {
      next.pageToken = String(body.pageToken).trim() || undefined
    }
    if (body.webhookVerifyToken !== undefined) next.webhookVerifyToken = String(body.webhookVerifyToken).trim() || undefined

    // El App Secret de Meta es ÚNICO por app (compartido con Instagram/WhatsApp Cloud).
    // Solo se sobreescribe si el usuario pega uno nuevo (máscara '••••' = conservar).
    // (UNIFICACIÓN 2026-11-21) Facebook/Messenger vive en ChannelConnection
    // (provider='meta_graph', clave 'meta:messenger:<pageId>'). El App Secret de
    // Meta se guarda DENTRO del blob cifrado (appSecret), compartido con el webhook.
    if (body.appSecret !== undefined && body.appSecret !== '' && !String(body.appSecret).startsWith('••••')) {
      next.appSecret = String(body.appSecret).trim()
    }
    const pageId = body.pageId !== undefined ? (String(body.pageId).trim() || null) : integration.facebookPageId
    await upsertChannelConnection({
      orgId: auth.orgId,
      channel: 'messenger',
      provider: 'meta_graph',
      providerAccountKey: pageId ? `meta:messenger:${pageId}` : `messenger:org:${auth.orgId}`,
      externalAccountId: pageId,
      credentialsEnc: encodeFacebookState(next),
      status: next.pageToken ? 'connected' : 'disconnected',
      metadata: { source: 'config' },
      eventType: next.pageToken ? 'connected' : 'disconnected',
      eventDetail: 'facebook_config_updated',
    })
    const updated = await getIntegration(auth.orgId)

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: {
        provider: 'facebook',
        pageId: body.pageId || integration.facebookPageId,
        tokenMasked: maskSecret(next.pageToken),
        appSecretConfigured: !!decryptSecret(updated.metaAppSecretEnc),
      },
    })

    return json({
      success: true,
      configured: !!(next.pageToken || body.pageId),
      config: {
        pageId: body.pageId || integration.facebookPageId || '',
        hasPageToken: !!next.pageToken,
        hasAppSecret: !!updated.metaAppSecretEnc,
        isActive: !!next.pageToken,
      },
    })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    await upsertChannelConnection({
      orgId: auth.orgId,
      channel: 'messenger',
      provider: 'meta_graph',
      providerAccountKey: integration.facebookPageId ? `meta:messenger:${integration.facebookPageId}` : `messenger:org:${auth.orgId}`,
      externalAccountId: null,
      credentialsEnc: encodeFacebookState({}),
      status: 'disconnected',
      eventType: 'disconnected',
      eventDetail: 'facebook_config_disconnected',
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'facebook', disconnected: true },
    })
    return json({ success: true, configured: false })
  })
}
