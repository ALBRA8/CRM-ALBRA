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
 * POST eventos — validación ESTRICTA de X-TikTok-Signature (HMAC-SHA256 con el
 *   App Secret cifrado por organización). Procesa mensajes entrantes del
 *   Business Messaging API (disponible cuando TikTok apruebe la app):
 *   find-or-create Client, timeline tiktok, workflows message_received,
 *   sin envío directo: las respuestas requieren la outbox canónica.
 *
 * Esquema de evento: TikTok no documenta públicamente el payload de mensajes
 * (vetado a socios). Parseo defensivo: se extrae remitente/texto de las
 * ubicaciones conocidas; cualquier evento se registra en timeline.
 */

interface TikTokEventBody {
  event?: string
  challenge?: string
  // ubicaciones posibles del mensaje según versiones del API de socios
  data?: Record<string, unknown>
  event_data?: Record<string, unknown>
  message?: { conversation_id?: string; text?: string; sender?: { id?: string } | string }
}

function extractEventId(body: TikTokEventBody): string | null {
  const candidates = [body as Record<string, unknown>, body.data, body.event_data]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    for (const key of ['event_id', 'eventId', 'id']) {
      const value = candidate[key]
      if ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isSafeInteger(value))) {
        return String(value).trim().slice(0, 255)
      }
    }
  }
  return null
}

function extractMessage(body: TikTokEventBody): { senderId: string; conversationId: string | null; text: string } | null {
  const m = body.message || body.data?.message || body.event_data?.message
  if (!m || typeof m !== 'object') return null
  const rec = m as Record<string, unknown>
  const sender = rec.sender
  const senderId =
    typeof sender === 'string'
      ? sender.trim()
      : typeof sender === 'object' && sender !== null
        ? String((sender as Record<string, unknown>).id || (sender as Record<string, unknown>).user_id || '').trim()
        : ''
  const conversationId = typeof rec.conversation_id === 'string' && rec.conversation_id.trim()
    ? rec.conversation_id.trim()
    : null
  const text = typeof rec.text === 'string' ? rec.text : ''
  // Never substitute conversation_id for sender identity, or synthesize a conversation ID.
  if (!senderId || !text) return null
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

    const signature = req.headers.get('x-tiktok-signature')
    const timestamp = req.headers.get('x-tiktok-timestamp')

    // Localiza la org validando la firma contra cada app secret configurado
    const candidates = await db.integration.findMany({
      where: { tiktokTokenEnc: { not: null } },
      select: { organizationId: true, tiktokTokenEnc: true },
    })
    const matches: Array<{ organizationId: string; credentialsEnc: string; appIdentity: string }> = []
    for (const candidate of candidates) {
      const state = parseTikTokState(candidate.tiktokTokenEnc)
      if (!state.appSecret) continue
      if (verifyTikTokSignature(rawBody, state.appSecret, signature, timestamp)) {
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
    const providerEventId = extractEventId(body)
    if (!providerEventId) return json({ ok: true, processed: false, reason: 'missing_event_id' })

    const eventKey = `event:${createHash('sha256').update(providerEventId).digest('hex')}`
    const connection = await getOrCreateTikTokWebhookConnection({
      organizationId: orgId,
      appIdentity: matchedAppIdentity,
      credentialsEnc: matchedCredentialsEnc,
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

    const msg = extractMessage(body)
    if (msg) {
      const client = await findOrCreateChannelClient({ orgId, platformKey: `tt:${msg.senderId}`, name: null, source: 'tiktok' })

      await recordTimelineEvent({
        orgId,
        clientId: client?.id || null,
        type: 'tiktok',
        title: 'Mensaje recibido por TikTok',
        description: msg.text.slice(0, 500),
        metadata: { senderId: msg.senderId, conversationId: msg.conversationId, direction: 'in', event: body.event || null },
        source: 'integration',
      })

      try {
        await runWorkflowsForTrigger({
          orgId,
          type: 'message_received',
          payload: { channel: 'tiktok', from: `tt:${msg.senderId}`, text: msg.text, ...(msg.conversationId ? { conversationId: msg.conversationId } : {}), clientId: client?.id, messageId: `tiktok_event_${createHash('sha256').update(providerEventId).digest('hex')}` },
        })
      } catch (err) {
        console.error('[tiktok webhook] workflows', err)
      }

      // El envío directo anterior usaba senderId como conversation_id y un
      // payload no compatible con Business Messaging API v1.3. No se despacha
      // desde el webhook: la respuesta automática permanece deshabilitada hasta
      // que el conversation_id documentado se persista en la outbox canónica.

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
