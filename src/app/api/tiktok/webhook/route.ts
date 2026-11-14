import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import {
  parseTikTokState,
  verifyTikTokSignature,
  findOrCreateChannelClient,
  buildNichoContext,
  getHandoffKeywords,
  isChannelAutoReplyGloballyEnabled,
} from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { llmReplyOrNotification } from '@/lib/channel-autoresponder'
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
 *   auto-respuesta IA (solo con sendEndpoint configurado).
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

function extractMessage(body: TikTokEventBody): { senderId: string; text: string } | null {
  const m = body.message || body.data?.message || body.event_data?.message
  if (!m || typeof m !== 'object') return null
  const rec = m as Record<string, unknown>
  const sender = rec.sender
  const senderId =
    typeof sender === 'string'
      ? sender
      : typeof sender === 'object' && sender !== null
        ? String((sender as Record<string, unknown>).id || (sender as Record<string, unknown>).user_id || '')
        : String(rec.conversation_id || '')
  const text = typeof rec.text === 'string' ? rec.text : ''
  if (!senderId || !text) return null
  return { senderId, text: text.slice(0, 3000) }
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
    let matchedOrgId: string | null = null
    let matchedCredentialsEnc: string | null = null
    let matchedAppIdentity: string | null = null
    for (const candidate of candidates) {
      const state = parseTikTokState(candidate.tiktokTokenEnc)
      if (!state.appSecret) continue
      if (verifyTikTokSignature(rawBody, state.appSecret, signature, timestamp)) {
        matchedOrgId = candidate.organizationId
        matchedCredentialsEnc = candidate.tiktokTokenEnc
        matchedAppIdentity = state.appKey || state.openId || state.appSecret
        break
      }
    }
    if (!matchedOrgId) {
      return json({ error: 'Firma inválida o app desconocida' }, { status: 401 })
    }
    const orgId = matchedOrgId
    if (!matchedCredentialsEnc || !matchedAppIdentity) {
      return json({ error: 'Identidad de aplicación TikTok incompleta' }, { status: 401 })
    }

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
        metadata: { senderId: msg.senderId, direction: 'in', event: body.event || null },
        source: 'integration',
      })

      try {
        await runWorkflowsForTrigger({
          orgId,
          type: 'message_received',
          payload: { channel: 'tiktok', from: `tt:${msg.senderId}`, text: msg.text, conversationId: `tt:${msg.senderId}`, clientId: client?.id, messageId: `tiktok_event_${createHash('sha256').update(providerEventId).digest('hex')}` },
        })
      } catch (err) {
        console.error('[tiktok webhook] workflows', err)
      }

      // Auto-respuesta IA (solo si TikTok aprobó el envío: sendEndpoint)
      const integration = await db.integration.findUnique({ where: { organizationId: orgId } })
      const state = parseTikTokState(integration?.tiktokTokenEnc)
      const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId }, select: { autoReplyEnabled: true } })
      // Direct TikTok sends are not yet backed by a durable outbound outbox.
      // Keep them disabled until the adapter/outbox path is implemented and reviewed.
      if (process.env.TIKTOK_AUTOREPLY_ENABLED === 'true' && isChannelAutoReplyGloballyEnabled() && state.accessToken && state.sendEndpoint && (nicho?.autoReplyEnabled ?? true)) {
        await llmReplyOrNotification({
          orgId,
          clientId: client?.id || null,
          channelLabel: 'TikTok',
          incomingText: msg.text,
          handoffKeywords: await getHandoffKeywords(orgId),
          nichoContext: await buildNichoContext(orgId),
          send: async (reply) => {
            const { sendTikTokBusinessMessage } = await import('@/lib/integrations')
            const sent = await sendTikTokBusinessMessage({ state, recipientId: msg.senderId, text: reply })
            await recordTimelineEvent({
              orgId,
              clientId: client?.id || null,
              type: 'tiktok',
              title: 'Respuesta automática del agente IA',
              description: reply.slice(0, 500),
              metadata: { senderId: msg.senderId, direction: 'out', delivered: sent.ok, error: sent.error || null },
              source: 'agent',
            })
          },
        })
      }
    }

    const completed = await completeChannelWebhookEvent(claim)
    if (completed.count !== 1) throw new Error('TikTok webhook claim lost before completion')

    // TikTok exige respuesta rápida; los eventos procesados quedan deduplicados.
    return json({ ok: true })
  } catch (err) {
    console.error('[tiktok webhook]', err)
    // Failed/stale claims are retryable. Do not acknowledge a persistence failure as success.
    return json({ ok: false, processed: false }, { status: 500 })
  }
}
