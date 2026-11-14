import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { parseInboxKey, parseWaNewKey } from '@/lib/inbox'
import { ChannelOutboundError, createChannelOutboundIntent } from '@/lib/channel-outbox'

/**
 * POST /api/inbox/send — envía un mensaje por el canal de la conversación.
 * Body: { key, contactHandle, clientId?, text }.
 *  - wa:<convId>       → daemon Baileys ({ to, text }, secreto server-to-server)
 *  - wa-new:<teléfono> → daemon Baileys + find-or-create de la conversación
 *                        (Task 19-b: cliente con teléfono y sin conversación)
 *  - tg:<clientId>     → Telegram Bot API (chatId = contactHandle) + timeline
 *  - ig:<clientId>     → Instagram Graph API (recipientId = contactHandle) + timeline
 * Graceful: canal sin configurar → 400 descriptivo (nunca 500).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as {
      key?: string
      contactHandle?: string
      clientId?: string | null
      text?: string
      clientRequestId?: string
    }
    requireFields(body as unknown as Record<string, unknown>, ['key', 'text'])
    const key = String(body.key)
    if (!parseInboxKey(key) && !parseWaNewKey(key)) {
      return json({ error: 'Conversación inválida' }, { status: 400 })
    }

    if (!String(body.text || '').trim()) {
      return json({ error: 'El mensaje está vacío' }, { status: 400 })
    }

    const parsedKey = parseInboxKey(key)
    if (key.startsWith('cc:') && parsedKey) {
      try {
        if (!body.clientRequestId) {
          return json({ error: 'clientRequestId requerido para conversaciones canónicas' }, { status: 400 })
        }
        const intent = await createChannelOutboundIntent({
          organizationId: auth.orgId,
          conversationId: parsedKey.id,
          clientRequestId: String(body.clientRequestId),
          body: String(body.text || ''),
          requestedByUserId: auth.userId,
        })
        return json({
          success: true,
          queued: true,
          sent: false,
          outboundId: intent.id,
          status: intent.status,
          clientRequestId: intent.clientRequestId,
        }, { status: 202 })
      } catch (error) {
        if (error instanceof ChannelOutboundError) {
          const status = error.code === 'NOT_FOUND' ? 404
            : error.code === 'NOT_SENDABLE' || error.code === 'IDEMPOTENCY_CONFLICT' ? 409
            : 400
          return json({ error: error.message, code: error.code }, { status })
        }
        throw error
      }
    }

    // Fail closed: solo las conversaciones canónicas pueden crear intenciones.
    return json({ error: 'El envío legacy está deshabilitado; abre una conversación canónica para enviar.', code: 'LEGACY_SEND_DISABLED' }, { status: 409 })
  })
}
