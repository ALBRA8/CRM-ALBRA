import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import {
  parseTikTokState,
  verifyTikTokSignature,
  findOrCreateChannelClient,
} from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { claimChannelWebhookEvent, completeChannelWebhookEvent, getChannelWebhookEventStatus, getOrCreateTikTokWebhookConnection } from '@/lib/channel-webhook-events'

/**
 * Webhook de TikTok (wiring-ready).
 *
 * GET/POST challenge — verificación de la URL en el portal de desarrolladores:
 *   TikTok envía un desafío que se devuelve tal cual (texto plano).
 * POST eventos — validación ESTRICTA de TikTok-Signature (HMAC-SHA256 con el
 *   App Secret cifrado por organización). Procesa mensajes entrantes del
 *   Business Messaging API (disponible cuando TikTok apruebe la app):
 *   find-or-create Client, timeline tiktok, workflows message_received,
 *   sin envío directo: las respuestas requieren la outbox canónica.
 *
 * El envelope Business Messaging usa client_key, user_openid y content
 * serializado; el parser admite únicamente campos de mensaje que permiten
 * recuperar sender, conversation_id y texto sin inventar identificadores.
 */

export interface TikTokEventBody {
  event?: string
  challenge?: string
  client_key?: string
  create_time?: number
  user_openid?: string
  content?: string | Record<string, unknown>
  data?: Record<string, unknown>
  event_data?: Record<string, unknown>
  message?: Record<string, unknown>
}

function parseTikTokContent(body: TikTokEventBody): Record<string, unknown> {
  if (body.content && typeof body.content === 'object' && !Array.isArray(body.content)) return body.content
  if (typeof body.content === 'string') {
    try {
      const parsed = JSON.parse(body.content) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch { /* unsupported content shape: reject message parsing */ }
  }
  return {}
}

function extractEventId(body: TikTokEventBody, requestLogId?: string | null): string | null {
  const content = parseTikTokContent(body)
  const candidates = [body as Record<string, unknown>, body.data, body.event_data, content, content.message as Record<string, unknown> | undefined]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    for (const key of ['event_id', 'eventId', 'message_id', 'messageId', 'id']) {
      const value = candidate[key]
      if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isSafeInteger(value))) {
        return String(value).trim().slice(0, 255)
      }
    }
  }
  // TikTok's x-tt-logid uniquely identifies a delivery request. It is a
  // last-resort idempotency key only when the event payload omits a message ID.
  return requestLogId && /^[A-Za-z0-9._:-]{8,128}$/.test(requestLogId) ? `logid:${requestLogId}` : null
}

export function extractTikTokMessage(body: TikTokEventBody): { senderId: string; conversationId: string; text: string } | null {
  const content = parseTikTokContent(body)
  const candidates = [
    body.message,
    body.data?.message as Record<string, unknown> | undefined,
    body.event_data?.message as Record<string, unknown> | undefined,
    content.message as Record<string, unknown> | undefined,
    content,
  ]
  const rec = candidates.find((candidate) => candidate && typeof candidate === 'object' &&
    (typeof candidate.conversation_id === 'string' || typeof candidate.conversationId === 'string')) as Record<string, unknown> | undefined
  if (!rec) return null
  const sender = rec.sender ?? rec.sender_openid ?? rec.sender_id ?? rec.from
  const senderId =
    typeof sender === 'string'
      ? sender.trim()
      : typeof sender === 'object' && sender !== null
        ? String((sender as Record<string, unknown>).id || (sender as Record<string, unknown>).open_id || (sender as Record<string, unknown>).user_openid || '').trim()
        : ''
  const conversationId = typeof rec.conversation_id === 'string' && rec.conversation_id.trim()
    ? rec.conversation_id.trim()
    : typeof rec.conversationId === 'string' && rec.conversationId.trim()
      ? rec.conversationId.trim()
      : ''
  const textValue = rec.text ?? rec.body ?? (typeof rec.message_content === 'object' && rec.message_content !== null
    ? (rec.message_content as Record<string, unknown>).text
    : undefined)
  const text = typeof textValue === 'string' ? textValue : ''
  if (!senderId || !conversationId || !text) return null
  return { senderId, conversationId, text: text.slice(0, 3000) }
}

/** Verificación de la URL (challenge) — TikTok la envía por GET o POST */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const challenge = url.searchParams.get('challenge') || url.searchParams.get('hub.challenge')
  if (!challenge) return json({ error: 'Falta challenge' }, { status: 400 })
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  try {
    let body: TikTokEventBody
    try {
      body = JSON.parse(rawBody) as TikTokEventBody
    } catch {
      return json({ error: 'Body inválido' }, { status: 400 })
    }

    // Challenge de verificación del portal
    if (typeof body.challenge === 'string' && body.challenge) {
      return new Response(body.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }

    const signature = req.headers.get('tiktok-signature')

    // Localiza la org validando la firma contra cada app secret configurado
    const candidates = await db.integration.findMany({
      where: { tiktokTokenEnc: { not: null } },
      select: { organizationId: true, tiktokTokenEnc: true },
    })
    const matches: Array<{ organizationId: string; credentialsEnc: string; appIdentity: string }> = []
    for (const candidate of candidates) {
      const state = parseTikTokState(candidate.tiktokTokenEnc)
      if (!state.appSecret) continue
      if (body.client_key && state.appKey !== body.client_key) continue
      if (body.user_openid && state.openId !== body.user_openid) continue
      if (verifyTikTokSignature(rawBody, state.appSecret, signature)) {
        matches.push({
          organizationId: candidate.organizationId,
          credentialsEnc: candidate.tiktokTokenEnc!,
          appIdentity: state.appKey || state.openId || state.appSecret,
        })
      }
    }
    if (matches.length === 0) {
      return json({ error: 'Firma inválida o app desconocida' }, { status: 401 })
    }
    // Shared app secrets must never route an event to whichever tenant sorts first.
    if (matches.length !== 1) {
      return json({ error: 'Firma válida pero identidad de organización ambigua' }, { status: 409 })
    }
    const [{ organizationId: orgId, credentialsEnc: matchedCredentialsEnc, appIdentity: matchedAppIdentity }] = matches

    // A stable provider event ID is required before any CRM/workflow side effect.
    // Never derive identity from message text: two legitimate messages can be identical.
    const providerEventId = extractEventId(body, req.headers.get('x-tt-logid'))
    if (!providerEventId) return json({ ok: true, processed: false, reason: 'missing_event_id' })

    const eventKey = `event:${createHash('sha256').update(providerEventId).digest('hex')}`
    const connection = await getOrCreateTikTokWebhookConnection({
      organizationId: orgId,
      appIdentity: matchedAppIdentity,
      externalAccountId: parseTikTokState(matchedCredentialsEnc).openId || '',
      credentialsEnc: matchedCredentialsEnc,
      readyForOutbound: !!(parseTikTokState(matchedCredentialsEnc).accessToken && parseTikTokState(matchedCredentialsEnc).openId),
    })
    const claim = await claimChannelWebhookEvent({
      organizationId: orgId,
      connectionId: connection.id,
      eventKey,
      eventType: (typeof body.event === 'string' && body.event.trim() ? body.event : 'tiktok.event').toLowerCase().replace(/[^a-z0-9:._-]/g, '_').slice(0, 80),
    })
    if (!claim) {
      const status = await getChannelWebhookEventStatus(connection.id, eventKey)
      return status === 'processed'
        ? json({ ok: true, duplicate: true })
        : json({ error: 'Evento TikTok ya está en procesamiento' }, { status: 503 })
    }

    const msg = extractTikTokMessage(body)
    if (msg) {
      const client = await findOrCreateChannelClient({ orgId, platformKey: `tt:${msg.senderId}`, name: null, source: 'tiktok' })
      // La conversación canónica se particiona por el conversation_id real
      // del proveedor; el sender ID queda asociado al cliente y metadata.
      const conversation = await db.channelConversation.upsert({
        where: { connectionId_externalContactKey: { connectionId: connection.id, externalContactKey: msg.conversationId } },
        create: {
          organizationId: orgId,
          connectionId: connection.id,
          channel: 'tiktok',
          externalContactKey: msg.conversationId,
          contactName: client?.name || msg.senderId,
        },
        update: { contactName: client?.name || msg.senderId },
      })
      const providerMessageId = `tiktok_event_${createHash('sha256').update(providerEventId).digest('hex')}`
      await db.channelMessage.upsert({
        where: { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId: providerMessageId } },
        create: {
          conversationId: conversation.id,
          externalMessageId: providerMessageId,
          direction: 'in',
          senderType: 'contact',
          body: msg.text,
          metadata: JSON.stringify({ provider: 'tiktok_business', senderId: msg.senderId, conversationId: msg.conversationId, eventId: providerEventId }),
        },
        update: {},
      })
      await db.channelConversation.update({
        where: { id: conversation.id },
        data: { lastMessage: msg.text.slice(0, 500), lastMessageAt: new Date(), unreadCount: { increment: 1 } },
      })

      await recordTimelineEvent({
        orgId,
        clientId: client?.id || null,
        type: 'tiktok',
        sourceEventKey: `tiktok:event:${createHash('sha256').update(providerEventId).digest('hex')}:inbound`,
        title: 'Mensaje recibido por TikTok',
        description: msg.text.slice(0, 500),
        metadata: { senderId: msg.senderId, conversationId: msg.conversationId, canonicalConversationId: conversation.id, direction: 'in', event: body.event || null },
        source: 'integration',
      })

      try {
        await runWorkflowsForTrigger({
          orgId,
          type: 'message_received',
          payload: { channel: 'tiktok', from: `tt:${msg.senderId}`, text: msg.text, conversationId: conversation.id, providerConversationId: msg.conversationId, clientId: client?.id, messageId: providerMessageId },
        })
      } catch (err) {
        console.error('[tiktok webhook] workflows', err)
      }
    }

    const completed = await completeChannelWebhookEvent(claim)
    if (completed.count !== 1) throw new Error('TikTok webhook claim lost before completion')

    // TikTok exige respuesta rápida; los eventos procesados quedan deduplicados.
    return json({ ok: true })
  } catch (err) {
    console.error('[tiktok webhook]', err)
    // Keep the claim leased after partial processing; retries receive 503 until lease expiry, then reclaim with a new fencing token.
    return json({ ok: false, processed: false }, { status: 500 })
  }
}
