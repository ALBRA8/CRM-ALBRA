import type { NextRequest } from 'next/server'
import { json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { safeEquals, parseTelegramState, sendTelegramBotMessage, findOrCreateChannelClient, getHandoffKeywords, buildNichoContext } from '@/lib/integrations'
import { notifyOrganization } from '@/lib/push'
import { llmChat } from '@/lib/ai'
import { transcribeAudioBase64 } from '@/lib/asr'
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
  voice?: { file_id: string; duration?: number; mime_type?: string }
  audio?: { file_id: string; duration?: number; mime_type?: string }
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
    if (!message) return json({ ok: true })

    const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.from?.username || null
    const platformKey = `tg:${message.chat.id}`

    // Notas de voz / audio: antes se descartaban silenciosamente ("if (!message?.text)").
    // Ahora se descargan del Bot API, se transcriben (ASR) y fluyen como texto por el
    // mismo camino: timeline, workflows message_received y auto-respuesta IA.
    let text = message.text ? message.text.slice(0, 4000) : null
    let isVoice = false
    if (!text && (message.voice || message.audio)) {
      const audio = message.voice || message.audio!
      try {
        const integration0 = await db.integration.findUnique({ where: { organizationId: orgId } })
        const state0 = parseTelegramState(integration0?.telegramBotTokenEnc)
        if (!state0.token) throw new Error('sin token de bot configurado')
        const buffer = await downloadTelegramFile({ token: state0.token, fileId: audio.file_id })
        text = await transcribeAudioBase64(buffer.toString('base64'))
        isVoice = true
        console.log(`[telegram webhook] nota de voz transcrita (${audio.duration ?? '?'}s): ${text.slice(0, 60)}`)
      } catch (err) {
        // Fail-open a humano: la nota queda registrada en timeline + push al equipo
        console.error('[telegram webhook] nota de voz no transcrita', err)
        const fbClient = await findOrCreateChannelClient({ orgId, platformKey, name: senderName, source: 'telegram' })
        await recordTimelineEvent({
          orgId,
          clientId: fbClient?.id || null,
          type: 'telegram',
          title: `Nota de voz recibida de ${senderName || platformKey} (no transcrita)`,
          description: 'No se pudo transcribir la nota de voz automáticamente. Revísala en la app de Telegram.',
          metadata: { chatId: String(message.chat.id), direction: 'in', voice: true, reason: err instanceof Error ? err.message : 'desconocido' },
          source: 'integration',
        })
        await notifyOrganization(orgId, {
          type: 'integration',
          title: 'Telegram: nota de voz sin transcribir',
          body: `${senderName || platformKey} envió una nota de voz que no se pudo transcribir. Revisa el chat en Telegram.`,
          data: JSON.stringify({ clientId: fbClient?.id, channel: 'telegram' }),
        })
        return json({ ok: true })
      }
    }
    if (!text) return json({ ok: true })

    // 1) Cliente asociado (find-or-create, aislado por org)
    const client = await findOrCreateChannelClient({ orgId, platformKey, name: senderName, source: 'telegram' })

    // 2) Timeline
    await recordTimelineEvent({
      orgId,
      clientId: client?.id || null,
      type: 'telegram',
      title: isVoice ? `Nota de voz de ${senderName || platformKey} (transcrita)` : `Mensaje recibido de ${senderName || platformKey}`,
      description: text.slice(0, 500),
      metadata: { chatId: String(message.chat.id), direction: 'in', messageId: message.message_id, ...(isVoice ? { voice: true } : {}) },
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
        // Transferencia a humano: notificación in-app + web-push (no responde la IA)
        await notifyOrganization(orgId, {
          type: 'integration',
          title: 'Telegram: el cliente pide un humano',
          body: `${senderName || platformKey}: ${text.slice(0, 200)}`,
          data: JSON.stringify({ clientId: client?.id, channel: 'telegram' }),
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

/** Descarga un archivo (nota de voz) del Bot API de Telegram vía getFile. */
async function downloadTelegramFile({ token, fileId }: { token: string; fileId: string }): Promise<Buffer> {
  const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!metaRes.ok) throw new Error(`getFile ${metaRes.status}`)
  const meta = (await metaRes.json()) as { ok?: boolean; result?: { file_path?: string } }
  const filePath = meta.result?.file_path
  if (!filePath) throw new Error('getFile sin file_path')

  const binRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!binRes.ok) throw new Error(`descarga de audio ${binRes.status}`)
  return Buffer.from(await binRes.arrayBuffer())
}
