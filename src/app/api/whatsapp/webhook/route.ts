import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import { decryptSecret } from '@/lib/crypto'
import {
  verifyMetaSignature,
  normalizePhone,
  findOrCreateChannelClient,
  buildNichoContext,
  getHandoffKeywords,
  sendWhatsAppCloud,
} from '@/lib/integrations'
import { llmReplyOrNotification } from '@/lib/channel-agent'
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
    button?: { text?: string }
    interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  }>
  statuses?: Array<{ id: string; status: string }>
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
  if (globalToken && token === globalToken) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
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
  try {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) return json({ error: 'Firma X-Hub-Signature-256 requerida' }, { status: 401 })

    let body: WaWebhookBody
    try {
      body = JSON.parse(rawBody) as WaWebhookBody
    } catch {
      return json({ error: 'Body inválido' }, { status: 400 })
    }

    // Localiza la org validando la firma contra cada app secret configurado.
    // OPTIMIZACIÓN (auditoría Antigravity, importante #4): si el webhook trae
    // phone_number_id, pre-filtramos por él ANTES del bucle criptográfico —
    // típicamente 1 candidato en vez de desencriptar + HMAC para TODAS las orgs.
    const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null
    const candidates = await db.integration.findMany({
      where: {
        metaAppSecretEnc: { not: null },
        ...(phoneNumberId ? { whatsappPhoneId: phoneNumberId } : {}),
      },
      select: { organizationId: true, metaAppSecretEnc: true, whatsappPhoneId: true, whatsappCloudTokenEnc: true },
    })
    let matchedOrgId: string | null = null
    let matchedValue: WaValue | null = null
    let matchedCloudToken: string | null = null
    let matchedPhoneId: string | null = null

    for (const candidate of candidates) {
      const secret = decryptSecret(candidate.metaAppSecretEnc)
      if (!secret) continue
      if (!verifyMetaSignature(rawBody, secret, signature)) continue
      for (const change of (body.entry || []).flatMap((e) => e.changes || [])) {
        const value = change.value
        if (!value) continue
        // Aislamiento multi-tenant: el phone_number_id debe ser el de esta org (si está definido)
        if (candidate.whatsappPhoneId && value.metadata?.phone_number_id && value.metadata.phone_number_id !== candidate.whatsappPhoneId) continue
        matchedOrgId = candidate.organizationId
        matchedValue = value
        matchedCloudToken = decryptSecret(candidate.whatsappCloudTokenEnc)
        matchedPhoneId = candidate.whatsappPhoneId
        break
      }
      if (matchedOrgId) break
    }

    if (!matchedOrgId) {
      return json({ error: 'Firma inválida o destinatario desconocido' }, { status: 401 })
    }

    const value = matchedValue as WaValue

    // Estados de entrega (sent/delivered/read) — solo timeline si hay clientId conocido
    for (const status of value.statuses || []) {
      await recordTimelineEvent({
        orgId: matchedOrgId,
        type: 'whatsapp',
        title: `Estado del mensaje: ${status.status}`,
        metadata: { messageId: status.id, status: status.status, direction: 'out' },
        source: 'integration',
      })
    }

    for (const message of value.messages || []) {
      const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title
      if (!text) continue
      const phone = normalizePhone(message.from)
      if (!phone) continue
      const profileName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name || null

      // find-or-create Client por teléfono (aislado por org)
      const client = await findOrCreateChannelClient({ orgId: matchedOrgId, platformKey: phone, name: profileName, source: 'whatsapp' })

      await recordTimelineEvent({
        orgId: matchedOrgId,
        clientId: client?.id || null,
        type: 'whatsapp',
        title: `Mensaje recibido de ${profileName || phone}`,
        description: text.slice(0, 500),
        metadata: { from: phone, direction: 'in', messageId: message.id },
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
    }

    // Meta exige 200 rápido
    return json({ ok: true })
  } catch (err) {
    console.error('[whatsapp webhook]', err)
    return json({ ok: true, processed: false })
  }
}
