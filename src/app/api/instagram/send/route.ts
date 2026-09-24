import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { getIntegration, parseInstagramState, sendInstagramGraphMessage } from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'

/**
 * POST /api/instagram/send — envía DM por Instagram Graph API.
 * Body: { recipientId, text, clientId? }. Graceful: sin token → 400 descriptivo.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { recipientId?: string; text?: string; clientId?: string }
    requireFields(body as unknown as Record<string, unknown>, ['recipientId', 'text'])

    const integration = await getIntegration(auth.orgId)
    const state = parseInstagramState(integration.instagramTokenEnc)
    if (!state.token) {
      return json({ error: 'Instagram no configurado. Guarda el Access Token en Configuración → Instagram.' }, { status: 400 })
    }

    const result = await sendInstagramGraphMessage({
      token: state.token,
      accountId: integration.instagramAccountId || '',
      recipientId: String(body.recipientId),
      text: String(body.text),
    })
    if (result.ok) {
      await recordTimelineEvent({
        orgId: auth.orgId,
        clientId: body.clientId || null,
        type: 'instagram',
        title: 'Mensaje enviado por Instagram',
        description: String(body.text).slice(0, 300),
        metadata: { recipientId: String(body.recipientId), direction: 'out' },
        source: 'manual',
        userId: auth.userId,
      })
      return json({ success: true, sent: true })
    }
    return json({ error: `Instagram API no pudo enviar: ${result.error}` }, { status: 400 })
  })
}
