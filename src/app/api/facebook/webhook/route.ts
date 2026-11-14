import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import { verifyMetaSignature, parseFacebookState, findOrCreateChannelClient, buildNichoContext, getHandoffKeywords, safeEquals, isChannelAutoReplyGloballyEnabled } from '@/lib/integrations'
import { decryptSecret } from '@/lib/crypto'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { llmReplyOrNotification } from '@/lib/channel-autoresponder'

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
 * Igual que Instagram: Meta exige 200 rápido (siempre 200 tras validar, sin 500).
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
    let matchedOrgId: string | null = null
    let matchedEntries: FbEntry[] = []

    for (const candidate of candidates) {
      const appSecret = decryptSecret(candidate.metaAppSecretEnc)
      if (!appSecret) continue
      if (verifyMetaSignature(rawBody, appSecret, signature)) {
        // (A2-12, auditoría 2026-11-11) TODAS las entry dirigidas a la Página
        // de esta org (antes `.find()` tomaba solo la primera y el resto de un
        // POST agrupado se perdía). Aislamiento multi-tenant intacto.
        const entries = (body.entry || []).filter((e) => !candidate.facebookPageId || e.id === candidate.facebookPageId)
        if (entries.length) {
          matchedOrgId = candidate.organizationId
          matchedEntries = entries
          break
        }
      }
    }

    if (!matchedOrgId || !matchedEntries.length) {
      return json({ error: 'Firma inválida o destinatario desconocido' }, { status: 401 })
    }

    const orgId = matchedOrgId
    const messagingItems = matchedEntries.flatMap((entry) => entry.messaging || [])
    for (const messaging of messagingItems) {
      const msg = messaging.message
      if (!msg?.text || msg.is_echo) continue
      const senderId = messaging.sender?.id
      if (!senderId) continue
      // (A4-02, auditoría 2026-11-11) Dedup durable por mid: Meta reintenta el
      // webhook ante timeouts; sin esto duplicaría timeline y respuestas IA.
      if (msg.mid) {
        const seen = await db.timelineEvent.findFirst({
          where: { organizationId: orgId, type: 'facebook', metadata: { contains: `"mid":"${msg.mid}"` } },
          select: { id: true },
        })
        if (seen) continue
      }
      const text = msg.text.slice(0, 3000)

      // find-or-create Client (phone = "fb:<psid>" para deduplicar por canal)
      const client = await findOrCreateChannelClient({ orgId, platformKey: `fb:${senderId}`, name: null, source: 'facebook' })

      await recordTimelineEvent({
        orgId,
        clientId: client?.id || null,
        type: 'facebook',
        title: 'Mensaje recibido por Facebook',
        description: text.slice(0, 500),
        metadata: { senderId, mid: msg.mid || null, direction: 'in' },
        source: 'integration',
      })

      try {
        await runWorkflowsForTrigger({
          orgId,
          type: 'message_received',
          payload: { channel: 'facebook', from: `fb:${senderId}`, text, conversationId: `fb:${senderId}`, clientId: client?.id },
        })
      } catch (err) {
        console.error('[facebook webhook] workflows', err)
      }

      // Auto-respuesta IA
      const integration = await db.integration.findUnique({ where: { organizationId: orgId } })
      const state = parseFacebookState(integration?.facebookTokenEnc)
      const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId }, select: { autoReplyEnabled: true } })
      if (isChannelAutoReplyGloballyEnabled() && state.pageToken && (nicho?.autoReplyEnabled ?? true)) {
        await llmReplyOrNotification({
          orgId,
          clientId: client?.id || null,
          channelLabel: 'Facebook',
          incomingText: text,
          handoffKeywords: await getHandoffKeywords(orgId),
          nichoContext: await buildNichoContext(orgId),
          send: async (reply) => {
            const { sendFacebookGraphMessage } = await import('@/lib/integrations')
            const sent = await sendFacebookGraphMessage({ token: state.pageToken!, pageId: integration?.facebookPageId || '', recipientId: senderId, text: reply })
            await recordTimelineEvent({
              orgId,
              clientId: client?.id || null,
              type: 'facebook',
              title: 'Respuesta automática del agente IA',
              description: reply.slice(0, 500),
              metadata: { senderId, direction: 'out', delivered: sent.ok },
              source: 'agent',
            })
          },
        })
      }
    }

    // Meta exige 200 rápido
    return json({ ok: true })
  } catch (err) {
    console.error('[facebook webhook]', err)
    return json({ ok: true, processed: false })
  }
}
