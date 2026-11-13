import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOrCreateChannelConversation } from '@/lib/channel-conversations'
import { claimChannelWebhookEvent, completeChannelWebhookEvent, failChannelWebhookEvent, getChannelWebhookEventStatus } from '@/lib/channel-webhook-events'
import { markChannelOutboundSent, updateChannelMessageDeliveryStatus } from '@/lib/channel-outbox'
import { json } from '@/lib/api-helpers'
import { decryptSecret } from '@/lib/crypto'
import { safeEqual } from '@/lib/internal-org-auth'
import {
  verifyMetaSignature,
  normalizePhone,
  findOrCreateChannelClient,
  buildNichoContext,
  getHandoffKeywords,
  sendWhatsAppCloud,
  safeEquals,
} from '@/lib/integrations'
import { llmReplyOrNotification } from '@/lib/channel-autoresponder'
import { forwardInboundToWhatspower } from '@/lib/whatspower-bridge'
import { transcribeAudioBase64 } from '@/lib/asr'
import { notifyOrganization } from '@/lib/push'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'

/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 * GET  — verificación de suscripción de Meta: hub.verify_token debe coincidir con el
 *        App Secret configurado (o con WHATSAPP_VERIFY_TOKEN global) → devuelve hub.challenge.
 * POST — validación ESTRICTA de X-Hub-Signature-256 (HMAC-SHA256 del body crudo con el
 *        App Secret cifrado por organización). CIERRA el fallo de auditoría (webhooks sin firma).
 *
 * Procesa mensajes entrantes: find-or-create Client por teléfono, timeline whatsapp,
 * trigger message_received, auto-respuesta IA (NichoConfig) enviada por Cloud API si hay
 * token configurado; si no, la respuesta queda registrada en el timeline.
 */

interface WaValue {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
  messages?: Array<{
    from: string
    id: string
    timestamp?: string
    text?: { body?: string }
    type?: string
    audio?: { id: string; mime_type?: string }
    button?: { text?: string }
    interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  }>
  statuses?: Array<{ id: string; status: string; timestamp?: string; biz_opaque_callback_data?: string }>
}

interface WaWebhookBody {
  object?: string
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WaValue }> }>
}

/** Verificación GET (Meta exige text/plain con el challenge) */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (!mode || !token || !challenge) {
    return NextResponse.json({ error: 'Faltan parámetros de verificación (hub.mode, hub.verify_token, hub.challenge)' }, { status: 400 })
  }
  if (mode !== 'subscribe') return new Response('Forbidden', { status: 403 })

  const globalToken = process.env.WHATSAPP_VERIFY_TOKEN
  // (A2-12) comparación en tiempo constante también en la verificación GET.
  if (globalToken && safeEquals(token, globalToken)) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  // FASE 1 (OLEADA 2): verify_token POR CONEXIÓN — cada número conectado
  // (WhatsAppConnection) recibe su propio webhookVerifyToken al crearse. La
  // suscripción de un número en Meta se valida SOLO con su token (comparación
  // en tiempo constante; el token NUNCA se devuelve en la respuesta).
  const connections = await db.whatsAppConnection.findMany({
    where: { status: { in: ['connected', 'pending'] } },
    select: { webhookVerifyToken: true },
  })
  for (const connection of connections) {
    if (safeEqual(token, connection.webhookVerifyToken)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
  }

  // verify_token por organización = App Secret configurado en Integration
  const integrations = await db.integration.findMany({
    where: { metaAppSecretEnc: { not: null } },
    select: { metaAppSecretEnc: true },
  })
  for (const integration of integrations) {
    const secret = decryptSecret(integration.metaAppSecretEnc)
    if (secret && token === secret) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  let activeWebhookEventId: string | null = null
  try {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) return json({ error: 'Firma X-Hub-Signature-256 requerida' }, { status: 401 })

    let body: WaWebhookBody
    try {
      body = JSON.parse(rawBody) as WaWebhookBody
    } catch {
      return json({ error: 'Body inválido' }, { status: 400 })
    }

    // Meta puede agrupar varios phone_number_id en un único POST. Resolver
    // cada número independientemente y nunca inferir la organización desde otro
    // evento del mismo payload.
    const allValues = (body.entry ?? [])
      .flatMap((entry) => entry.changes ?? [])
      .map((change) => change.value)
      .filter((value): value is WaValue => !!value)
    const phoneNumberIds = [...new Set(allValues.map((value) => value.metadata?.phone_number_id).filter((id): id is string => !!id))]
    const matchedTargets: Array<{ orgId: string; phoneId: string; cloudToken: string | null; fallbackValue: WaValue }> = []

    for (const phoneId of phoneNumberIds) {
      const connection = await db.whatsAppConnection.findUnique({
        where: { phoneNumberId: phoneId },
        select: { organizationId: true, status: true, accessTokenEnc: true, metaAppSecretEnc: true },
      })
      if (connection) {
        if (connection.status !== 'connected') continue
        const secrets = [decryptSecret(connection.metaAppSecretEnc), process.env.META_APP_SECRET].filter((secret): secret is string => !!secret)
        const validSignature = secrets.some((secret) => verifyMetaSignature(rawBody, secret, signature))
        if (validSignature) {
          const matchingValue = allValues.find((value) => value.metadata?.phone_number_id === phoneId)
          if (matchingValue) {
            matchedTargets.push({
              orgId: connection.organizationId,
              phoneId,
              cloudToken: decryptSecret(connection.accessTokenEnc),
              fallbackValue: matchingValue,
            })
          }
        }
        // Una conexión canónica existente es autoritativa: nunca degradar a
        // Integration ante firma inválida o estado desconectado.
        continue
      }

      // Compatibilidad con organizaciones aún no migradas a WhatsAppConnection.
      const legacyCandidates = await db.integration.findMany({
        where: { metaAppSecretEnc: { not: null }, whatsappPhoneId: phoneId },
        select: { organizationId: true, metaAppSecretEnc: true, whatsappCloudTokenEnc: true, whatsappPhoneId: true },
      })
      for (const candidate of legacyCandidates) {
        const secret = decryptSecret(candidate.metaAppSecretEnc)
        if (!secret || !verifyMetaSignature(rawBody, secret, signature)) continue
        const matchingValue = allValues.find((value) => value.metadata?.phone_number_id === phoneId)
        if (!matchingValue) continue
        matchedTargets.push({
          orgId: candidate.organizationId,
          phoneId,
          cloudToken: decryptSecret(candidate.whatsappCloudTokenEnc),
          fallbackValue: matchingValue,
        })
        break
      }
    }

    if (matchedTargets.length === 0) {
      return json({ error: 'Firma inválida o destinatario desconocido' }, { status: 401 })
    }

    // Cada número tiene su propio tenant, token y partición de conversaciones.
    for (const target of matchedTargets) {
      const matchedOrgId = target.orgId
      const matchedPhoneId = target.phoneId
      const fallbackValue = target.fallbackValue
      let matchedCloudToken = target.cloudToken
      let matchedCanonicalConnectionId: string | null = null
      // La conexión canónica es la lectura primaria de credenciales cuando
      // existe. WhatsAppConnection se conserva como autoridad de atribución y
      // fallback durante la migración gradual.
      if (matchedPhoneId) {
        const providerAccountKey = `meta:whatsapp:${matchedPhoneId}`
        const canonical = await db.channelConnection.findUnique({
          where: { providerAccountKey },
          select: { id: true, organizationId: true, channel: true, status: true, credentialsEnc: true },
        })
        if (canonical) {
          matchedCanonicalConnectionId = canonical.id
          if (canonical.organizationId !== matchedOrgId || canonical.channel !== 'whatsapp' || canonical.status !== 'connected') {
            continue
          }
          const plaintext = decryptSecret(canonical.credentialsEnc)
          if (!plaintext) continue
          try {
            const credentials = JSON.parse(plaintext) as { accessToken?: string }
            if (!credentials.accessToken) continue
            matchedCloudToken = credentials.accessToken
          } catch {
            continue
          }
        }
      }
  
        // (A1-09, auditoría 2026-11-11) Meta puede agrupar VARIAS entry/changes
      // en un solo POST: se procesan TODAS las ocurrencias del número de la org
      // autenticada. Antes solo se leía entry[0].changes[0] y el resto se
      // descartaba en silencio → mensajes perdidos sin traza.
      const processableValues = allValues.filter((value) => value.metadata?.phone_number_id === matchedPhoneId)
      for (const value of processableValues.length ? processableValues : [fallbackValue]) {
      // Estados de entrega (sent/delivered/read) — dedup por messageId también
      // aquí (reauditoría ciclo 2): los reintentos de Meta duplicaban el timeline
      // de estados aunque los mensajes ya se filtraran.
      for (const status of value.statuses || []) {
        // Correlación mediante biz_opaque_callback_data. El callback puede
        // adelantarse al ACK HTTP y convertir sending/unknown en sent.
        if (
          status.id &&
          status.biz_opaque_callback_data &&
          /^[A-Za-z0-9_-]{8,128}$/.test(status.biz_opaque_callback_data) &&
          ['sent', 'delivered', 'read', 'failed'].includes(status.status)
        ) {
          const outbound = await db.channelOutboundMessage.findUnique({
            where: { id: status.biz_opaque_callback_data },
            include: {
              conversation: {
                include: {
                  connection: { select: { organizationId: true, channel: true, provider: true, externalAccountId: true } },
                },
              },
            },
          })
          if (
            outbound &&
            outbound.conversation.organizationId === matchedOrgId &&
            outbound.conversation.connection.organizationId === matchedOrgId &&
            outbound.conversation.channel === 'whatsapp' &&
            outbound.conversation.connection.channel === 'whatsapp' &&
            outbound.conversation.connection.provider === 'meta_cloud' &&
            outbound.conversation.connection.externalAccountId === matchedPhoneId
          ) {
            if (outbound.status === 'sending' || outbound.status === 'unknown') {
              await markChannelOutboundSent({ id: outbound.id, providerMessageId: status.id })
            }
            if (outbound.status === 'sent' || outbound.status === 'sending' || outbound.status === 'unknown') {
              await updateChannelMessageDeliveryStatus({
                conversationId: outbound.conversationId,
                providerMessageId: status.id,
                status: status.status as 'sent' | 'delivered' | 'read' | 'failed',
                timestamp: status.timestamp,
              })
            }
          }
        }
        if (status.id && matchedCanonicalConnectionId) {
          const claim = await claimChannelWebhookEvent({
            organizationId: matchedOrgId,
            connectionId: matchedCanonicalConnectionId,
            eventKey: `status:${status.id}:${status.status}`,
            eventType: 'whatsapp.status',
          })
          if (!claim) {
            const eventKey = `status:${status.id}:${status.status}`
            const state = await getChannelWebhookEventStatus(matchedCanonicalConnectionId, eventKey)
            if (state === 'processed') continue
            throw new Error('WEBHOOK_EVENT_BUSY')
          }
          activeWebhookEventId = claim.id
        }
        if (status.id) {
          const seenStatus = await db.timelineEvent.findFirst({
            where: {
              organizationId: matchedOrgId,
              type: 'whatsapp',
              AND: [
                { metadata: { contains: `"messageId":"${status.id}"` } },
                { metadata: { contains: `"status":"${status.status}"` } },
              ],
            },
            select: { id: true },
          })
          if (seenStatus) {
            if (activeWebhookEventId) {
              await completeChannelWebhookEvent(activeWebhookEventId)
              activeWebhookEventId = null
            }
            continue
          }
        }
        await recordTimelineEvent({
          orgId: matchedOrgId,
          type: 'whatsapp',
          title: `Estado del mensaje: ${status.status}`,
          metadata: { messageId: status.id, status: status.status, direction: 'out' },
          source: 'integration',
        })
        if (activeWebhookEventId) {
          await completeChannelWebhookEvent(activeWebhookEventId)
          activeWebhookEventId = null
        }
      }
  
      for (const message of value.messages || []) {
        if (message.id && matchedCanonicalConnectionId) {
          const claim = await claimChannelWebhookEvent({
            organizationId: matchedOrgId,
            connectionId: matchedCanonicalConnectionId,
            eventKey: `message:${message.id}`,
            eventType: 'whatsapp.message',
          })
          if (!claim) {
            const eventKey = `message:${message.id}`
            const state = await getChannelWebhookEventStatus(matchedCanonicalConnectionId, eventKey)
            if (state === 'processed') continue
            throw new Error('WEBHOOK_EVENT_BUSY')
          }
          activeWebhookEventId = claim.id
        }
        // ================================================================
        // (A4-02, auditoría 2026-11-11) DEDUP por waMessageId: Meta re-entrega
        // webhooks ante timeout; sin dedup, la auto-respuesta IA salía DOS
        // veces al cliente. El índice único (organizationId, waMessageId) —
        // migración 4 — respalda el lookup; si ya existe, se omite (200 temprano
        // ya fue respondido por Meta en la primera entrega).
        // ================================================================
        if (message.id) {
          const seen = await db.whatsAppMessage.findFirst({
            where: { organizationId: matchedOrgId, waMessageId: message.id },
            select: { id: true },
          })
          if (seen) {
            if (activeWebhookEventId) {
              await completeChannelWebhookEvent(activeWebhookEventId)
              activeWebhookEventId = null
            }
            continue
          }
        }
        let text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title
        let isVoice = false
  
        // Notas de voz (Cloud API type 'audio'): antes se descartaban ("if (!text) continue").
        // Se descargan del Graph API con el token Cloud de la org y se transcriben (ASR).
        if (!text && message.audio && matchedCloudToken) {
          try {
            const buf = await downloadWaCloudMedia({ token: matchedCloudToken, mediaId: message.audio.id })
            text = await transcribeAudioBase64(buf.toString('base64'))
            isVoice = true
          } catch (err) {
            // Fail-open a humano: la nota queda registrada en timeline + push al equipo
            console.error('[whatsapp webhook] nota de voz no transcrita', err)
            const phoneFall = normalizePhone(message.from)
            if (phoneFall) {
              const fbClient = await findOrCreateChannelClient({ orgId: matchedOrgId, platformKey: phoneFall, name: null, source: 'whatsapp' })
              await recordTimelineEvent({
                orgId: matchedOrgId,
                clientId: fbClient?.id || null,
                type: 'whatsapp',
                title: `Nota de voz recibida de ${phoneFall} (no transcrita)`,
                description: 'No se pudo transcribir la nota de voz automáticamente. Escucha el audio desde WhatsApp.',
                metadata: { from: phoneFall, direction: 'in', voice: true, reason: err instanceof Error ? err.message : 'desconocido' },
                source: 'integration',
              })
              await notifyOrganization(matchedOrgId, {
                type: 'integration',
                title: 'WhatsApp: nota de voz sin transcribir',
                body: `${phoneFall} envió una nota de voz que no se pudo transcribir. Escucha el audio en WhatsApp.`,
                data: JSON.stringify({ clientId: fbClient?.id, channel: 'whatsapp' }),
              })
            }
          }
        }
        // (A4-02, auditoría 2026-11-11) Dedup DURABLE por waMessageId: Meta
        // reintenta el webhook ante timeouts y una doble ejecución duplicaría
        // timeline + respuestas IA + reenvío al puente. Lookup previo del mensaje
        // ya registrado en TimelineEvent. Nota honesta (reauditoría ciclo 2): el
        // índice único parcial (organizationId, waMessageId) de la migración
        // 4_audit_indexes cierra la vía de escritura del DAEMON (tabla
        // WhatsAppMessage); este lookup check-then-act conserva una ventana
        // TOCTOU residual ante POSTs verdaderamente simultáneos.
        if (message.id) {
          const seen = await db.timelineEvent.findFirst({
            where: {
              organizationId: matchedOrgId,
              type: 'whatsapp',
              metadata: { contains: `"messageId":"${message.id}"` },
            },
            select: { id: true },
          })
          if (seen) {
            if (activeWebhookEventId) {
              await completeChannelWebhookEvent(activeWebhookEventId)
              activeWebhookEventId = null
            }
            continue
          }
        }
        if (!text) {
          if (activeWebhookEventId) {
            await completeChannelWebhookEvent(activeWebhookEventId)
            activeWebhookEventId = null
          }
          continue
        }
        const phone = normalizePhone(message.from)
        if (!phone) {
          if (activeWebhookEventId) {
            await completeChannelWebhookEvent(activeWebhookEventId)
            activeWebhookEventId = null
          }
          continue
        }
        const profileName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name || null
  
        // Conversación canónica: particionada por el phone_number_id exacto
        // (conexión) y el teléfono externo del contacto.
        const channelConversation = matchedPhoneId
          ? await getOrCreateChannelConversation({
              providerAccountKey: `meta:whatsapp:${matchedPhoneId}`,
              channel: 'whatsapp',
              externalContactKey: phone,
              contactName: profileName,
            })
          : null
        if (channelConversation) {
          await db.channelConversation.update({
            where: { id: channelConversation.id },
            data: {
              lastMessage: text.slice(0, 500),
              lastMessageAt: new Date(),
              unreadCount: { increment: 1 },
            },
          })
        }
        if (channelConversation && message.id) {
          await db.channelMessage.upsert({
            where: {
              conversationId_externalMessageId: {
                conversationId: channelConversation.id,
                externalMessageId: message.id,
              },
            },
            create: {
              conversationId: channelConversation.id,
              externalMessageId: message.id,
              direction: 'in',
              senderType: 'contact',
              body: text,
              messageType: isVoice ? 'voice' : message.type || 'text',
              metadata: JSON.stringify({ from: phone }),
            },
            update: {},
          })
        }
  
        // find-or-create Client por teléfono (aislado por org)
        const client = await findOrCreateChannelClient({ orgId: matchedOrgId, platformKey: phone, name: profileName, source: 'whatsapp' })
  
        await recordTimelineEvent({
          orgId: matchedOrgId,
          clientId: client?.id || null,
          type: 'whatsapp',
          title: isVoice ? `Nota de voz de ${profileName || phone} (transcrita)` : `Mensaje recibido de ${profileName || phone}`,
          description: text.slice(0, 500),
          metadata: { from: phone, direction: 'in', messageId: message.id, ...(isVoice ? { voice: true } : {}) },
          source: 'integration',
        })
  
        try {
          await runWorkflowsForTrigger({
            orgId: matchedOrgId,
            type: 'message_received',
            payload: { channel: 'whatsapp', from: phone, text, conversationId: phone, clientId: client?.id },
          })
        } catch (err) {
          console.error('[whatsapp webhook] workflows', err)
        }
  
        // Inbound Bridge CRM→WHATSPOWER (Nivel 2): reenvía el mensaje entrante
        // firmado (HMAC-SHA256 + timestamp) al motor conversacional. Fire-and-forget:
        // si WHATSPOWER está caído o deshabilitado el CRM sigue operativo (modo
        // Nivel 1 autónomo, ver README de WHATSPOWER).
        forwardInboundToWhatspower({
          orgId: matchedOrgId,
          phone,
          name: profileName,
          text,
          messageId: message.id,
        }).catch((err) => console.error('[whatsapp webhook] whatspower bridge', err))
  
        // Auto-respuesta IA
        const nicho = await db.nichoConfig.findUnique({ where: { organizationId: matchedOrgId }, select: { autoReplyEnabled: true } })
        if (nicho?.autoReplyEnabled ?? true) {
          await llmReplyOrNotification({
            orgId: matchedOrgId,
            clientId: client?.id || null,
            channelLabel: 'WhatsApp',
            incomingText: text,
            handoffKeywords: await getHandoffKeywords(matchedOrgId),
            nichoContext: await buildNichoContext(matchedOrgId),
            send: async (reply) => {
              if (matchedCloudToken && matchedPhoneId) {
                const sent = await sendWhatsAppCloud({ token: matchedCloudToken, phoneId: matchedPhoneId, to: phone, text: reply })
                await recordTimelineEvent({
                  orgId: matchedOrgId,
                  clientId: client?.id || null,
                  type: 'whatsapp',
                  title: 'Respuesta automática del agente IA',
                  description: reply.slice(0, 500),
                  metadata: { to: phone, direction: 'out', delivered: sent.ok, via: 'cloud-api' },
                  source: 'agent',
                })
              } else {
                // Sin Cloud token: la respuesta queda registrada en el timeline para envío manual
                await recordTimelineEvent({
                  orgId: matchedOrgId,
                  clientId: client?.id || null,
                  type: 'whatsapp',
                  title: 'Respuesta sugerida por el agente IA (sin envío automático)',
                  description: reply.slice(0, 500),
                  metadata: { to: phone, direction: 'out', delivered: false, via: 'timeline' },
                  source: 'agent',
                })
              }
            },
          })
        }
        if (activeWebhookEventId) {
          await completeChannelWebhookEvent(activeWebhookEventId)
          activeWebhookEventId = null
        }
      }
  
      }
  
      }

    // Meta exige 200 rápido
    return json({ ok: true })
  } catch (err) {
    if (activeWebhookEventId) {
      await failChannelWebhookEvent(activeWebhookEventId, 'PROCESSING_FAILED').catch(() => undefined)
    }
    console.error('[whatsapp webhook]', err)
    return json({ ok: false, processed: false }, { status: 500 })
  }
}

/** Descarga un media (nota de voz) de la Cloud API de Meta vía Graph API. */
async function downloadWaCloudMedia({ token, mediaId }: { token: string; mediaId: string }): Promise<Buffer> {
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!metaRes.ok) throw new Error(`graph media ${metaRes.status}`)
  const meta = (await metaRes.json()) as { url?: string }
  if (!meta.url) throw new Error('graph media sin url')

  const binRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!binRes.ok) throw new Error(`descarga de audio ${binRes.status}`)
  return Buffer.from(await binRes.arrayBuffer())
}
