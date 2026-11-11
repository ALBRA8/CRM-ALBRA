import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { getIntegration, parseFacebookState, sendFacebookGraphMessage } from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'

/**
 * POST /api/facebook/send — envía mensaje por Messenger de la Página (Graph API).
 * Body: { recipientId, text, clientId? }. Graceful: sin token → 400 descriptivo.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { recipientId?: string; text?: string; clientId?: string }
    requireFields(body as unknown as Record<string, unknown>, ['recipientId', 'text'])

    const integration = await getIntegration(auth.orgId)
    const state = parseFacebookState(integration.facebookTokenEnc)
    if (!state.pageToken || !integration.facebookPageId) {
      return json({ error: 'Facebook no configurado. Guarda el Page Token y el Page ID en Configuración → Facebook.' }, { status: 400 })
    }

    const result = await sendFacebookGraphMessage({
      token: state.pageToken,
      pageId: integration.facebookPageId,
      recipientId: String(body.recipientId),
      text: String(body.text),
    })
    if (result.ok) {
      await recordTimelineEvent({
        orgId: auth.orgId,
        clientId: body.clientId || null,
        type: 'facebook',
        title: 'Mensaje enviado por Facebook',
        description: String(body.text).slice(0, 300),
        metadata: { recipientId: String(body.recipientId), direction: 'out' },
        source: 'manual',
        userId: auth.userId,
      })
      return json({ success: true, sent: true })
    }
    return json({ error: `Facebook API no pudo enviar: ${result.error}` }, { status: 400 })
  })
}
