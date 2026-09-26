import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/crypto'
import { getIntegration } from '@/lib/integrations'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET /api/whatsapp/config — estado de la integración WhatsApp Cloud (sin secretos)
 * PUT /api/whatsapp/config — (admin) guarda metaAppSecretEnc, whatsappCloudTokenEnc, whatsappPhoneId
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
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
    const auth = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as WhatsAppConfigBody
    await getIntegration(auth.orgId)

    const data: Record<string, unknown> = {}
    if (body.whatsappPhoneId !== undefined) data.whatsappPhoneId = String(body.whatsappPhoneId).trim() || null
    if (body.whatsappCloudToken !== undefined && body.whatsappCloudToken !== '') {
      data.whatsappCloudTokenEnc = encryptSecret(String(body.whatsappCloudToken).trim())
    }
    if (body.metaAppSecret !== undefined && body.metaAppSecret !== '') {
      data.metaAppSecretEnc = encryptSecret(String(body.metaAppSecret).trim())
    }
    if (typeof body.enableWhatsApp === 'boolean') data.enableWhatsApp = body.enableWhatsApp

    const integration = await db.integration.update({ where: { organizationId: auth.orgId }, data })

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
