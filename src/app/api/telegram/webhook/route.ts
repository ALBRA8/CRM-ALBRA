import type { NextRequest } from 'next/server'
import { json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { safeEquals, parseTelegramState, sendTelegramBotMessage, findOrCreateChannelClient, getHandoffKeywords, buildNichoContext } from '@/lib/integrations'
import { llmChat } from '@/lib/ai'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'

/**
 * POST /api/telegram/webhook — PÚBLICO pero con validación ESTRICTA del header
 * X-Telegram-Bot-Api-Secret-Token contra Integration.telegramSecret (cierra el
 * fallo de auditoría). Multi-tenant: el secret identifica la organización y el
 * mensaje se aísla por Integration→organizationId.
 *
 * Procesa: message_received (workflows) + auto-respuesta IA con NichoConfig + timeline.
 * Siempre responde 200 a Telegram tras validar (evita reintentos infinitos).
 */

interface TgMessage {
  message_id: number
  from?: { id: number; first_name?: string; last_name?: string; username?: string }
  chat: { id: number; type: string }
  text?: string
}

interface TgUpdate {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
  channel_post?: TgMessage
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  try {
    const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
    if (!secretHeader) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    // El secret del header identifica la organización (búsqueda por índice único de valor)
    const matched = await db.integration.findFirst({
      where: { telegramSecret: secretHeader },
      select: { organizationId: true },
    })
    if (!matched) return json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    // Comparación estricta en tiempo constante (defensa en profundidad)
    const stored = await db.integration.findUnique({
      where: { organizationId: matched.organizationId },
      select: { telegramSecret: true },
    })
    if (!stored?.telegramSecret || !safeEquals(stored.telegramSecret, secretHeader)) {
      return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const orgId = matched.organizationId
    const update = JSON.parse(rawBody) as TgUpdate
    const message = update.message || update.edited_message || update.channel_post
    if (!message?.text) return json({ ok: true })

    const text = message.text.slice(0, 4000)
    const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.from?.username || null
    const platformKey = `tg:${message.chat.id}`

    // 1) Cliente asociado (find-or-create, aislado por org)
    const client = await findOrCreateChannelClient({ orgId, platformKey, name: senderName, source: 'telegram' })

    // 2) Timeline
    await recordTimelineEvent({
      orgId,
      clientId: client?.id || null,
      type: 'telegram',
      title: `Mensaje recibido de ${senderName || platformKey}`,
      description: text.slice(0, 500),
      metadata: { chatId: String(message.chat.id), direction: 'in', messageId: message.message_id },
      source: 'integration',
    })

    // 3) Workflows del negocio
    try {
      await runWorkflowsForTrigger({
        orgId,
        type: 'message_received',
        payload: { channel: 'telegram', from: platformKey, text, conversationId: platformKey, clientId: client?.id },
      })
    } catch (err) {
      console.error('[telegram webhook] workflows', err)
    }

    // 4) Auto-respuesta IA (si está habilitada y no pide humano)
    const integrationFull = await db.integration.findUnique({ where: { organizationId: orgId } })
    const state = parseTelegramState(integrationFull?.telegramBotTokenEnc)
    if (state.autoReply !== false && state.token && message.chat.type === 'private') {
      const handoffKeywords = await getHandoffKeywords(orgId)
      const wantsHuman = handoffKeywords.some((k) => text.toLowerCase().includes(k.toLowerCase()))
      const nicho = await db.nichoConfig.findUnique({ where: { organizationId: orgId }, select: { autoReplyEnabled: true } })

      if (!wantsHuman && (nicho?.autoReplyEnabled ?? true)) {
        try {
          const nichoCtx = await buildNichoContext(orgId)
          const reply = await llmChat(
            orgId,
            [
              {
                role: 'system',
                content: `Eres el agente comercial por Telegram de un negocio. Responde SIEMPRE en español, breve (máx 3 oraciones), cordial y orientado a agendar una cita o cotizar.\n\nCONTEXTO DEL NEGOCIO:\n${nichoCtx}\n\nResponde solo con el texto del mensaje; sin comillas ni prefijos.`,
              },
              { role: 'user', content: text },
            ],
            { temperature: 0.5 }
          )
          if (reply.trim()) {
            const sent = await sendTelegramBotMessage({ token: state.token, chatId: message.chat.id, text: reply.trim() })
            await recordTimelineEvent({
              orgId,
              clientId: client?.id || null,
              type: 'telegram',
              title: 'Respuesta automática del agente IA',
              description: reply.trim().slice(0, 500),
              metadata: { chatId: String(message.chat.id), direction: 'out', delivered: sent.ok },
              source: 'agent',
            })
          }
        } catch (err) {
          console.error('[telegram webhook] auto-respuesta IA falló', err)
        }
      } else if (wantsHuman && state.token) {
        // Transferencia a humano: notificar y no responder con IA
        await db.notification.create({
          data: {
            organizationId: orgId,
            type: 'integration',
            title: 'Telegram: el cliente pide un humano',
            body: `${senderName || platformKey}: ${text.slice(0, 200)}`,
            data: JSON.stringify({ clientId: client?.id, channel: 'telegram' }),
          },
        })
      }
    }

    return json({ ok: true })
  } catch (err) {
    console.error('[telegram webhook]', err)
    // Nunca 500 a Telegram: evita reintentos infinitos
    return json({ ok: true, processed: false })
  }
}
