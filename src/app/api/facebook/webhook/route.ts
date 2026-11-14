import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import { verifyMetaSignature, parseFacebookState, findOrCreateChannelClient, buildNichoContext, getHandoffKeywords, safeEquals, isChannelAutoReplyGloballyEnabled } from '@/lib/integrations'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { llmReplyOrNotification } from '@/lib/channel-autoresponder'
import { getOrCreateChannelConversation } from '@/lib/channel-conversations'
import { createChannelOutboundIntent, getChannelOutboundIntentByRequestId } from '@/lib/channel-outbox'
import { claimChannelWebhookEvent, completeChannelWebhookEvent, failChannelWebhookEvent, getOrCreateMessengerWebhookConnection } from '@/lib/channel-webhook-events'

/**
 * Webhook de Facebook (Messenger de la Página — Meta Graph).
 *
 * GET  — verificación de suscripción: hub.mode=subscribe && hub.verify_token ===
 *        FacebookState.webhookVerifyToken → hub.challenge (text/plain).
 * POST — validación ESTRICTA de X-Hub-Signature-256 (HMAC-SHA256 del body crudo con
 *        el App Secret cifrado en Integration.metaAppSecretEnc, la misma app de Meta).
 *        Aislamiento multi-tenant: entry[].id === Integration.facebookPageId.
 *
 * Procesa mensajes: find-or-create Client (phone="fb:<psid>"), timeline facebook,
 * workflows message_received, auto-respuesta IA con NichoConfig.
 * Los fallos de persistencia/claim devuelven 500 para que Meta pueda reintentar el evento.
 */

interface FbMessaging {
  sender?: { id: string }
  recipient?: { id: string }
  message?: { mid?: string; text?: string; is_echo?: boolean }
}

interface FbEntry {
  id: string
  time?: number
  messaging?: FbMessaging[]
}

interface FbWebhookBody {
  object?: string
  entry?: FbEntry[]
}

/** Verificación de suscripción (Meta exige text/plain con el challenge) */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (!mode || !token || !challenge) {
    return NextResponse.json({ error: 'Faltan parámetros de verificación (hub.mode, hub.verify_token, hub.challenge)' }, { status: 400 })
  }
  // El verify token lo define cada organización al configurar Facebook
  const integrations = await db.integration.findMany({
    where: { facebookTokenEnc: { not: null } },
    select: { facebookTokenEnc: true },
  })
  for (const integration of integrations) {
    const state = parseFacebookState(integration.facebookTokenEnc)
    // (A2-12) comparación en tiempo constante.
    if (state.webhookVerifyToken && safeEquals(token, state.webhookVerifyToken)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  try {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) return json({ error: 'Firma X-Hub-Signature-256 requerida' }, { status: 401 })

    let body: FbWebhookBody
    try {
      body = JSON.parse(rawBody) as FbWebhookBody
    } catch {
      return json({ error: 'Body inválido' }, { status: 400 })
    }

    // Localiza la org validando la firma HMAC contra cada App Secret configurado
    const candidates = await db.integration.findMany({
      where: { facebookTokenEnc: { not: null }, metaAppSecretEnc: { not: null } },
      select: { organizationId: true, facebookTokenEnc: true, facebookPageId: true, metaAppSecretEnc: true },
    })
    const matchedTargets: Array<{ orgId: string; pageId: string; credentialsEnc: string; entries: FbEntry[] }> = []

    for (const candidate of candidates) {
      const appSecret = decryptSecret(candidate.metaAppSecretEnc)
      if (!appSecret || !verifyMetaSignature(rawBody, appSecret, signature)) continue
      const state = parseFacebookState(candidate.facebookTokenEnc)
      // Fail closed: a shared Meta App Secret is not enough to identify a tenant.
      // Match the same Page identity and credential envelope used by the canonical backfill.
      const pageId = state.pageId || candidate.facebookPageId
      if (!pageId || !state.pageToken) continue
      const entries = (body.entry || []).filter((entry) => entry.id === pageId)
      const credentialsEnc = encryptSecret(JSON.stringify({
        accessToken: state.pageToken,
        appSecret,
        webhookVerifyToken: state.webhookVerifyToken || null,
      }))
      if (entries.length && credentialsEnc) matchedTargets.push({ orgId: candidate.organizationId, pageId, credentialsEnc, entries })
    }

    if (!matchedTargets.length) {
      return json({ error: 'Firma inválida o destinatario desconocido' }, { status: 401 })
    }

    // A single Meta batch can contain events for multiple Pages/tenants.
    // Resolve and process each matching Page independently.
    for (const target of matchedTargets) {
      const orgId = target.orgId
      const messagingItems = target.entries.flatMap((entry) => entry.messaging || [])
      const connection = await getOrCreateMessengerWebhookConnection({
        organizationId: orgId,
        pageId: target.pageId,
        credentialsEnc: target.credentialsEnc,
      })
      for (const messaging of messagingItems) {
        const msg = messaging.message
        if (!msg?.text || msg.is_echo) continue
        const senderId = messaging.sender?.id
        if (!senderId) continue
        // A provider message ID is the stable identity. The canonical ledger
        // atomically claims it before any CRM/workflow/auto-reply side effect.
        // Without mid there is no stable provider identity, so this event cannot be durably deduplicated.
        let eventClaim: { id: string; claimToken: string } | null = null
        if (msg.mid) {
          eventClaim = await claimChannelWebhookEvent({
            organizationId: orgId,
            connectionId: connection.id,
            eventKey: 'message:' + msg.mid,
            eventType: 'messenger.message',
          })
          if (!eventClaim) continue
        }

        try {
          const text = msg.text.slice(0, 3000)
          const client = await findOrCreateChannelClient({ orgId, platformKey: 'fb:' + senderId, name: null, source: 'facebook' })

          await recordTimelineEvent({
            orgId,
            clientId: client?.id || null,
            type: 'facebook',
            title: 'Mensaje recibido por Facebook',
            description: text.slice(0, 500),
            metadata: { senderId, mid: msg.mid || null, direction: 'in' },
            source: 'integration',
          })

          await runWorkflowsForTrigger({
            orgId,
            type: 'message_received',
            payload: { channel: 'facebook', from: 'fb:' + senderId, text, conversationId: 'fb:' + senderId, clientId: client?.id, ...(msg.mid ? { messageId: msg.mid } : {}) },
          })

          const integration = await db.integration.findUnique({ where: { organizationId: orgId } })
          const state = parseFacebookState(integration?.facebookTokenEnc)
          const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId }, select: { autoReplyEnabled: true } })
          const canonicalConversation = msg.mid
            ? await getOrCreateChannelConversation({
                providerAccountKey: `meta:messenger:${target.pageId}`,
                channel: 'messenger',
                externalContactKey: senderId,
              })
            : null
          if (msg.mid && !canonicalConversation) throw new Error('MESSENGER_CANONICAL_CONVERSATION_UNAVAILABLE')

          if (canonicalConversation && msg.mid) {
            // Persist inbound identity in the canonical thread. Provider mid is
            // unique per conversation and prevents duplicate canonical messages.
            let insertedInbound = false
            try {
              await db.channelMessage.create({
                data: {
                  conversationId: canonicalConversation.id,
                  externalMessageId: msg.mid,
                  direction: 'in',
                  senderType: 'contact',
                  body: text,
                  metadata: JSON.stringify({ senderId, source: 'messenger_webhook' }),
                },
              })
              insertedInbound = true
            } catch (error) {
              if ((error as { code?: string } | null)?.code !== 'P2002') throw error
            }
            if (insertedInbound) {
              await db.channelConversation.update({
                where: { id: canonicalConversation.id },
                data: { lastMessage: text.slice(0, 500), lastMessageAt: new Date(), unreadCount: { increment: 1 } },
              })
            }
          }

          if (isChannelAutoReplyGloballyEnabled() && state.pageToken && (nicho?.autoReplyEnabled ?? true) && canonicalConversation && msg.mid) {
            const clientRequestId = `messenger-auto-reply:${msg.mid}`
            // A webhook retry after enqueue must reuse the first persisted reply,
            // not regenerate different text under the same idempotency key.
            const existingIntent = await getChannelOutboundIntentByRequestId({
              conversationId: canonicalConversation.id,
              clientRequestId,
            })
            if (!existingIntent) {
              await llmReplyOrNotification({
                orgId,
                clientId: client?.id || null,
                channelLabel: 'Facebook',
                incomingText: text,
                handoffKeywords: await getHandoffKeywords(orgId),
                nichoContext: await buildNichoContext(orgId),
                send: async (reply) => {
                  await createChannelOutboundIntent({
                    organizationId: orgId,
                    conversationId: canonicalConversation.id,
                    clientRequestId,
                    body: reply,
                  })
                },
              })
            }
          }
          if (eventClaim) await completeChannelWebhookEvent(eventClaim)
        } catch (err) {
          if (eventClaim) await failChannelWebhookEvent(eventClaim, 'MESSENGER_HANDLER_FAILED')
          throw err
        }
      }
    }

    // Meta exige 200 rápido
    return json({ ok: true })
  } catch (err) {
    console.error('[facebook webhook]', err)
    return json({ ok: false, processed: false }, { status: 500 })
  }
}
