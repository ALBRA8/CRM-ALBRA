import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { getIntegration, parseFacebookState, encodeFacebookState } from '@/lib/integrations'
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
    const auth = requireAdmin(req)
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
    const auth = requireAdmin(req)
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
    const data: Record<string, unknown> = {
      facebookTokenEnc: encodeFacebookState(next),
      ...(body.pageId !== undefined ? { facebookPageId: String(body.pageId).trim() || null } : {}),
      enableFacebook: !!next.pageToken,
    }
    if (body.appSecret !== undefined && body.appSecret !== '' && !String(body.appSecret).startsWith('••••')) {
      const { encryptSecret } = await import('@/lib/crypto')
      data.metaAppSecretEnc = encryptSecret(String(body.appSecret).trim())
    }

    const updated = await db.integration.update({ where: { organizationId: auth.orgId }, data })

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
    const auth = requireAdmin(req)
    await db.integration.update({
      where: { organizationId: auth.orgId },
      data: {
        facebookTokenEnc: null,
        facebookPageId: null,
        facebookPageName: null,
        facebookUserEmail: null,
        enableFacebook: false,
      },
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
