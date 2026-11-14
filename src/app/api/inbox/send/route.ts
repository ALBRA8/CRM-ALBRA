import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { sendInboxMessage, parseInboxKey, parseWaNewKey } from '@/lib/inbox'
import { rememberMessage, maybeConsolidate } from '@/lib/memory'
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

    // No permitir que las keys legacy evadan el worker y la outbox canónica.
    // La bandeja debe usar cc:<conversationId> para cualquier envío.
    return json({ error: 'El envío legacy está deshabilitado; abre una conversación canónica para enviar.', code: 'LEGACY_SEND_DISABLED' }, { status: 409 })

    const result = await sendInboxMessage({
      orgId: auth.orgId,
      userId: auth.userId,
      key,
      contactHandle: String(body.contactHandle || ''),
      // (segunda reparación §2.B) El cliente referenciado debe existir y pertenecer
      // a la organización del remitente — jamás se acepta un id de otra org.
      clientId: await (async () => {
        const clientId = body.clientId || null
        if (!clientId) return null
        const c = await db.client.findFirst({ where: { id: String(clientId), organizationId: auth.orgId }, select: { id: true } })
        if (!c) return null
        return String(clientId)
      })(),
      text: String(body.text || ''),
    })
    if (!result.ok) return json({ error: result.error }, { status: 400 })
    // Memoria vectorial (Fase 5): el mensaje saliente del vendedor también
    // alimenta el recuerdo del cliente. Fire-and-forget: nunca bloquea el envío.
    const channel = key.startsWith('wa') ? 'whatsapp' : key.startsWith('tg') ? 'telegram' : 'instagram'
    const safeClientId = body.clientId && (await db.client.findFirst({ where: { id: String(body.clientId), organizationId: auth.orgId }, select: { id: true } })) ? String(body.clientId) : null
    void rememberMessage({ orgId: auth.orgId, clientId: safeClientId, channel, role: 'outgoing', text: String(body.text || '') })
    maybeConsolidate(auth.orgId, safeClientId)
    return json({ success: true, sent: true })
  })
}
