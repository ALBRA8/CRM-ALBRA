import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import { getOrCreateChannelConversation } from '@/lib/channel-conversations'
import { claimChannelWebhookEvent, completeChannelWebhookEvent, failChannelWebhookEvent, getChannelWebhookEventStatus } from '@/lib/channel-webhook-events'
import { json } from '@/lib/api-helpers'
import { verifyMetaSignature, parseInstagramState, findOrCreateChannelClient, buildNichoContext, getHandoffKeywords } from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { llmReplyOrNotification } from '@/lib/channel-autoresponder'

/**
 * Webhook de Instagram (Meta Graph).
 *
 * GET  — verificación de suscripción: hub.mode=subscribe && hub.verify_token === webhookVerifyToken → hub.challenge (text/plain)
 * POST — validación ESTRICTA de X-Hub-Signature-256 (HMAC-SHA256 del body crudo con el App
 *        Secret cifrado por organización). Aísla multi-tenant: entry[].id === Integration.instagramAccountId.
 *
 * Procesa mensajes: find-or-create Client, timeline instagram, workflows message_received,
 * auto-respuesta IA con NichoConfig.
 */

interface IgMessaging {
  sender?: { id: string }
  recipient?: { id: string }
  message?: { mid?: string; text?: string; is_echo?: boolean }
}

interface IgEntry {
  id: string
  time?: number
  messaging?: IgMessaging[]
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>
}

interface IgWebhookBody {
  object?: string
  entry?: IgEntry[]
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
  const connections = await db.channelConnection.findMany({
    where: { channel: 'instagram', provider: 'meta_graph', status: 'connected' },
    select: { credentialsEnc: true },
  })
  for (const connection of connections) {
    const plaintext = decryptSecret(connection.credentialsEnc)
    if (!plaintext) continue
    try {
      const credentials = JSON.parse(plaintext) as { webhookVerifyToken?: string | null }
      if (credentials.webhookVerifyToken && credentials.webhookVerifyToken === token) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      }
    } catch { /* no autorizar credenciales corruptas */ }
  }

  // Compatibilidad temporal para conexiones legacy sin ChannelConnection.
  const integrations = await db.integration.findMany({
    where: { instagramTokenEnc: { not: null } },
    select: { instagramTokenEnc: true },
  })
  for (const integration of integrations) {
    const state = parseInstagramState(integration.instagramTokenEnc)
    if (state.webhookVerifyToken && token === state.webhookVerifyToken) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let activeWebhookEventClaim: { id: string; claimToken: string } | null = null
  try {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) return json({ error: 'Firma X-Hub-Signature-256 requerida' }, { status: 401 })

    const matchedTargets: Array<{ orgId: string; entry: IgEntry; accountId: string; connectionId?: string; accessToken: string }> = []
    let body: IgWebhookBody
    try {
      body = JSON.parse(rawBody) as IgWebhookBody
    } catch {
      return json({ error: 'Body inválido' }, { status: 400 })
    }

    // Resolver por ID de cuenta exacto y credenciales de esa conexión.
    const connectionCandidates = await db.channelConnection.findMany({
      where: { channel: 'instagram', provider: 'meta_graph', status: 'connected' },
      select: { id: true, organizationId: true, externalAccountId: true, credentialsEnc: true },
    })
    for (const candidate of connectionCandidates) {
      const plaintext = decryptSecret(candidate.credentialsEnc)
      if (!plaintext) continue
      let credentials: { accessToken?: string; appSecret?: string }
      try { credentials = JSON.parse(plaintext) as typeof credentials } catch { continue }
      if (!credentials.appSecret || !credentials.accessToken) continue
      if (!verifyMetaSignature(rawBody, credentials.appSecret, signature)) continue
      const entries = (body.entry || []).filter((item) => item.id === candidate.externalAccountId)
      for (const entry of entries) {
        matchedTargets.push({
          orgId: candidate.organizationId,
          entry,
          accountId: candidate.externalAccountId,
          connectionId: candidate.id,
          accessToken: credentials.accessToken,
        })
      }
    }

    // Fallback de compatibilidad: solo cuentas no migradas al modelo canónico.
    {
      const legacyCandidates = await db.integration.findMany({
        where: { instagramTokenEnc: { not: null } },
        select: { organizationId: true, instagramTokenEnc: true, instagramAccountId: true },
      })
      for (const candidate of legacyCandidates) {
        // Una conexión canónica existente es autoritativa incluso si está
        // desconectada o su firma no valida: nunca degradar a Integration.
        const canonicalAccount = candidate.instagramAccountId
          ? await db.channelConnection.findFirst({
              where: {
                channel: 'instagram',
                provider: 'meta_graph',
                externalAccountId: candidate.instagramAccountId,
              },
              select: { id: true },
            })
          : null
        if (canonicalAccount) continue
        const state = parseInstagramState(candidate.instagramTokenEnc)
        if (!state.webhookSecret || !candidate.instagramAccountId) continue
        if (!verifyMetaSignature(rawBody, state.webhookSecret, signature)) continue
        if (matchedTargets.some((target) => target.accountId === candidate.instagramAccountId)) continue
        const entries = (body.entry || []).filter((item) => item.id === candidate.instagramAccountId)
        for (const entry of entries) {
          if (!state.token) continue
          matchedTargets.push({
            orgId: candidate.organizationId,
            entry,
            accountId: candidate.instagramAccountId,
            accessToken: state.token,
          })
        }
      }
    }

    if (matchedTargets.length === 0) {
      return json({ error: 'Firma inválida o destinatario desconocido' }, { status: 401 })
    }

    // Procesar cada cuenta destinataria por separado. Un mismo POST de Meta
    // puede agrupar entries de varias cuentas; nunca reutilizar el token de
    // una cuenta para otra ni descartar las entries posteriores.
    for (const target of matchedTargets) {
      const { orgId, entry, accountId, connectionId, accessToken } = target
      for (const messaging of entry.messaging || []) {
      const msg = messaging.message

      // Meta emite echoes para mensajes enviados por la cuenta profesional.
      // Persistirlos como salientes: si el worker confirma después el mismo mid,
      // markChannelOutboundSent enlazará esa fila y no creará un duplicado.
      if (msg?.is_echo && msg.text && messaging.recipient?.id) {
        if (msg.mid && connectionId) {
          const claim = await claimChannelWebhookEvent({
            organizationId: orgId,
            connectionId,
            eventKey: `message:${msg.mid}`,
            eventType: 'instagram.echo',
          })
          if (!claim) {
            const state = await getChannelWebhookEventStatus(connectionId, `message:${msg.mid}`)
            if (state === 'processed') continue
            throw new Error('WEBHOOK_EVENT_BUSY')
          }
          activeWebhookEventClaim = claim
        }
        const echoText = msg.text.slice(0, 3000)
        const echoConversation = await getOrCreateChannelConversation({
          providerAccountKey: `meta:instagram:${accountId}`,
          channel: 'instagram',
          externalContactKey: messaging.recipient.id,
        })
        if (echoConversation && msg.mid) {
          await db.channelMessage.upsert({
            where: {
              conversationId_externalMessageId: {
                conversationId: echoConversation.id,
                externalMessageId: msg.mid,
              },
            },
            create: {
              conversationId: echoConversation.id,
              externalMessageId: msg.mid,
              direction: 'out',
              senderType: 'agent',
              body: echoText,
              messageType: 'text',
              metadata: JSON.stringify({ echo: true, recipientId: messaging.recipient.id }),
            },
            update: {},
          })
          await db.channelConversation.update({
            where: { id: echoConversation.id },
            data: { lastMessage: echoText.slice(0, 500), lastMessageAt: new Date() },
          })
        }
        if (activeWebhookEventClaim) {
          await completeChannelWebhookEvent(activeWebhookEventClaim)
          activeWebhookEventClaim = null
        }
        continue
      }

      if (!msg?.text) continue
      const senderId = messaging.sender?.id
      if (!senderId) continue
      const text = msg.text.slice(0, 3000)
      if (msg.mid && connectionId) {
        const claim = await claimChannelWebhookEvent({
          organizationId: orgId,
          connectionId,
          eventKey: `message:${msg.mid}`,
          eventType: 'instagram.message',
        })
        if (!claim) {
          const state = await getChannelWebhookEventStatus(connectionId, `message:${msg.mid}`)
          if (state === 'processed') continue
          throw new Error('WEBHOOK_EVENT_BUSY')
        }
        activeWebhookEventClaim = claim
        // Recuperación de crash: si el timeline ya recibió el mid, no repetir
        // workflows/autorespuesta; cerrar el ledger reclamado y omitir el evento.
        const seen = await db.timelineEvent.findFirst({
          where: {
            organizationId: orgId,
            type: 'instagram',
            metadata: { contains: `"mid":"${msg.mid}"` },
          },
          select: { id: true },
        })
        if (seen) {
          await completeChannelWebhookEvent(activeWebhookEventClaim)
          activeWebhookEventClaim = null
          continue
        }
      }

      const conversation = await getOrCreateChannelConversation({
        providerAccountKey: `meta:instagram:${accountId}`,
        channel: 'instagram',
        externalContactKey: senderId,
      })
      if (conversation) {
        const messageData = {
          conversationId: conversation.id,
          direction: 'in',
          senderType: 'contact',
          body: text,
          messageType: 'text',
          metadata: JSON.stringify({ senderId }),
        }
        if (msg.mid) {
          await db.channelMessage.upsert({
            where: {
              conversationId_externalMessageId: {
                conversationId: conversation.id,
                externalMessageId: msg.mid,
              },
            },
            create: { ...messageData, externalMessageId: msg.mid },
            update: {},
          })
        } else {
          await db.channelMessage.create({ data: messageData })
        }
        await db.channelConversation.update({
          where: { id: conversation.id },
          data: { lastMessage: text.slice(0, 500), lastMessageAt: new Date(), unreadCount: { increment: 1 } },
        })
      }

      // find-or-create Client (phone = "ig:<senderId>" para deduplicar por canal)
      const client = await findOrCreateChannelClient({ orgId, platformKey: `ig:${senderId}`, name: null, source: 'instagram' })

      await recordTimelineEvent({
        orgId,
        clientId: client?.id || null,
        type: 'instagram',
        title: 'Mensaje recibido por Instagram',
        description: text.slice(0, 500),
        metadata: { senderId, mid: msg.mid || null, direction: 'in' },
        source: 'integration',
      })

      try {
        await runWorkflowsForTrigger({
          orgId,
          type: 'message_received',
          payload: { channel: 'instagram', from: `ig:${senderId}`, text, conversationId: `ig:${senderId}`, clientId: client?.id, ...(msg.mid ? { messageId: msg.mid } : {}) },
        })
      } catch (err) {
        console.error('[instagram webhook] workflows', err)
      }

      // Auto-respuesta IA
      const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId }, select: { autoReplyEnabled: true } })
      if (accessToken && (nicho?.autoReplyEnabled ?? true)) {
        await llmReplyOrNotification({
          orgId,
          clientId: client?.id || null,
          channelLabel: 'Instagram',
          incomingText: text,
          handoffKeywords: await getHandoffKeywords(orgId),
          nichoContext: await buildNichoContext(orgId),
          send: async (reply) => {
            const { sendInstagramGraphMessage } = await import('@/lib/integrations')
            const sent = await sendInstagramGraphMessage({ token: accessToken, accountId, recipientId: senderId, text: reply })
            await recordTimelineEvent({
              orgId,
              clientId: client?.id || null,
              type: 'instagram',
              title: 'Respuesta automática del agente IA',
              description: reply.slice(0, 500),
              metadata: { senderId, direction: 'out', delivered: sent.ok },
              source: 'agent',
            })
          },
        })
      }
      if (activeWebhookEventClaim) {
        await completeChannelWebhookEvent(activeWebhookEventClaim)
        activeWebhookEventClaim = null
      }
      }
    }

    // Meta exige 200 rápido
    return json({ ok: true })
  } catch (err) {
    if (activeWebhookEventClaim) {
      await failChannelWebhookEvent(activeWebhookEventClaim, 'PROCESSING_FAILED').catch(() => undefined)
    }
    console.error('[instagram webhook]', err)
    return json({ ok: false, processed: false }, { status: 500 })
  }
}
