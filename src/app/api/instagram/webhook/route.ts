import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import { verifyMetaSignature, parseInstagramState, findOrCreateChannelClient, buildNichoContext, getHandoffKeywords } from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { llmReplyOrNotification } from '@/lib/channel-agent'

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
  // El verify token lo define cada organización al configurar Instagram
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
  try {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) return json({ error: 'Firma X-Hub-Signature-256 requerida' }, { status: 401 })

    // Localiza la org validando la firma contra cada app secret configurado
    const candidates = await db.integration.findMany({
      where: { instagramTokenEnc: { not: null } },
      select: { organizationId: true, instagramTokenEnc: true, instagramAccountId: true },
    })
    let matchedOrgId: string | null = null
    let matchedEntry: IgEntry | null = null
    let body: IgWebhookBody
    try {
      body = JSON.parse(rawBody) as IgWebhookBody
    } catch {
      return json({ error: 'Body inválido' }, { status: 400 })
    }

    for (const candidate of candidates) {
      const state = parseInstagramState(candidate.instagramTokenEnc)
      if (!state.webhookSecret) continue
      if (verifyMetaSignature(rawBody, state.webhookSecret, signature)) {
        // Aislamiento multi-tenant: la entrada debe dirigirse al accountId de esta org
        const entry = (body.entry || []).find((e) => !candidate.instagramAccountId || e.id === candidate.instagramAccountId)
        if (entry) {
          matchedOrgId = candidate.organizationId
          matchedEntry = entry
          break
        }
      }
    }

    if (!matchedOrgId || !matchedEntry) {
      return json({ error: 'Firma inválida o destinatario desconocido' }, { status: 401 })
    }

    const orgId = matchedOrgId
    for (const messaging of matchedEntry.messaging || []) {
      const msg = messaging.message
      if (!msg?.text || msg.is_echo) continue
      const senderId = messaging.sender?.id
      if (!senderId) continue
      const text = msg.text.slice(0, 3000)

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
          payload: { channel: 'instagram', from: `ig:${senderId}`, text, conversationId: `ig:${senderId}`, clientId: client?.id },
        })
      } catch (err) {
        console.error('[instagram webhook] workflows', err)
      }

      // Auto-respuesta IA
      const integration = await db.integration.findUnique({ where: { organizationId: orgId } })
      const state = parseInstagramState(integration?.instagramTokenEnc)
      const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId }, select: { autoReplyEnabled: true } })
      if (state.token && (nicho?.autoReplyEnabled ?? true)) {
        await llmReplyOrNotification({
          orgId,
          clientId: client?.id || null,
          channelLabel: 'Instagram',
          incomingText: text,
          handoffKeywords: await getHandoffKeywords(orgId),
          nichoContext: await buildNichoContext(orgId),
          send: async (reply) => {
            const { sendInstagramGraphMessage } = await import('@/lib/integrations')
            const sent = await sendInstagramGraphMessage({ token: state.token!, accountId: integration?.instagramAccountId || '', recipientId: senderId, text: reply })
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
    }

    // Meta exige 200 rápido
    return json({ ok: true })
  } catch (err) {
    console.error('[instagram webhook]', err)
    return json({ ok: true, processed: false })
  }
}
