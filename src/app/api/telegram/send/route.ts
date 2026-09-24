import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { getIntegration, parseTelegramState, sendTelegramBotMessage } from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'

/**
 * POST /api/telegram/send — envía un mensaje por Telegram Bot API.
 * Graceful: sin token → 400 descriptivo (nunca 500).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { chatId?: string | number; text?: string; clientId?: string }
    requireFields(body as unknown as Record<string, unknown>, ['chatId', 'text'])

    const integration = await getIntegration(auth.orgId)
    const state = parseTelegramState(integration.telegramBotTokenEnc)
    if (!state.token) {
      return json({ error: 'Telegram no configurado. Guarda el Bot Token en Configuración → Telegram.' }, { status: 400 })
    }

    const result = await sendTelegramBotMessage({ token: state.token, chatId: body.chatId as string | number, text: String(body.text) })
    if (result.ok) {
      await recordTimelineEvent({
        orgId: auth.orgId,
        clientId: body.clientId || null,
        type: 'telegram',
        title: 'Mensaje enviado por Telegram',
        description: String(body.text).slice(0, 300),
        metadata: { chatId: String(body.chatId), direction: 'out' },
        source: 'manual',
        userId: auth.userId,
      })
      return json({ success: true, sent: true })
    }
    return json({ error: `Telegram API no pudo enviar: ${result.error}` }, { status: 400 })
  })
}
