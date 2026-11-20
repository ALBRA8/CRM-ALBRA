import type { NextRequest } from 'next/server'
import { requireAdmin, HttpError } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/crypto'
import { getIntegration, upsertChannelConnection } from '@/lib/integrations'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET /api/whatsapp/config — estado de la integración WhatsApp Cloud (sin secretos)
 * PUT /api/whatsapp/config — (admin) guarda metaAppSecretEnc, whatsappCloudTokenEnc, whatsappPhoneId
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const cloudToken = decryptSecret(integration.whatsappCloudTokenEnc)
    const appSecret = decryptSecret(integration.metaAppSecretEnc)
    return json({
      configured: !!(cloudToken || integration.whatsappPhoneId || appSecret),
      config: {
        phoneId: integration.whatsappPhoneId || '',
        hasCloudToken: !!cloudToken,
        cloudTokenPreview: maskSecret(cloudToken),
        hasAppSecret: !!appSecret,
        isActive: integration.enableWhatsApp && !!cloudToken && !!integration.whatsappPhoneId,
      },
    })
  })
}

interface WhatsAppConfigBody {
  whatsappPhoneId?: string
  whatsappCloudToken?: string
  metaAppSecret?: string
  enableWhatsApp?: boolean
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as WhatsAppConfigBody
    const integration = await getIntegration(auth.orgId)

    const data: Record<string, unknown> = {}
    if (body.whatsappPhoneId !== undefined) data.whatsappPhoneId = String(body.whatsappPhoneId).trim() || null
    if (body.whatsappCloudToken !== undefined && body.whatsappCloudToken !== '') {
      data.whatsappCloudTokenEnc = encryptSecret(String(body.whatsappCloudToken).trim())
    }
    if (body.metaAppSecret !== undefined && body.metaAppSecret !== '') {
      data.metaAppSecretEnc = encryptSecret(String(body.metaAppSecret).trim())
    }
    if (typeof body.enableWhatsApp === 'boolean') data.enableWhatsApp = body.enableWhatsApp

    // (UNIFICACIÓN 2026-11-21) La configuración legacy de un solo número vive
    // ahora en ChannelConnection (provider='meta_cloud'): clave
    // 'meta:whatsapp:<phoneId>' cuando hay phoneId, o 'meta:whatsapp:org:<orgId>'
    // mientras no se haya registrado el número en Meta.
    const phoneId = typeof data.whatsappPhoneId === 'string' && data.whatsappPhoneId
      ? data.whatsappPhoneId
      : (integration.whatsappPhoneId || null)
    const credentialsEnc = encryptSecret(JSON.stringify({
      accessToken: data.whatsappCloudTokenEnc ? decryptSecret(String(data.whatsappCloudTokenEnc)) : null,
      appSecret: data.metaAppSecretEnc ? decryptSecret(String(data.metaAppSecretEnc)) : (decryptSecret(integration.metaAppSecretEnc) || null),
      webhookVerifyToken: null,
    }))
    if (!credentialsEnc) {
      throw new HttpError(500, 'Cifrado no disponible: configura APP_ENCRYPTION_KEY o APP_SECRET')
    }
    await upsertChannelConnection({
      orgId: auth.orgId,
      channel: 'whatsapp',
      provider: 'meta_cloud',
      providerAccountKey: phoneId ? `meta:whatsapp:${phoneId}` : `meta:whatsapp:org:${auth.orgId}`,
      externalAccountId: phoneId,
      credentialsEnc,
      status: (data.enableWhatsApp === true || (data.enableWhatsApp === undefined && integration.enableWhatsApp)) && (data.whatsappCloudTokenEnc || integration.whatsappCloudTokenEnc)
        ? 'connected'
        : 'disconnected',
      metadata: {
        source: 'manual',
        statusDetail: 'Configuración WhatsApp Cloud (ajustes clásicos)',
        phoneNumber: phoneId,
      },
      eventType: 'connected',
      eventDetail: 'whatsapp_legacy_config_updated',
    })
    const updated = await getIntegration(auth.orgId)

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: {
        provider: 'whatsapp',
        phoneId: integration.whatsappPhoneId,
        cloudTokenConfigured: !!integration.whatsappCloudTokenEnc,
        appSecretConfigured: !!integration.metaAppSecretEnc,
      },
    })

    return json({
      success: true,
      config: {
        phoneId: integration.whatsappPhoneId || '',
        hasCloudToken: !!integration.whatsappCloudTokenEnc,
        hasAppSecret: !!integration.metaAppSecretEnc,
        isActive: integration.enableWhatsApp,
      },
    })
  })
}
