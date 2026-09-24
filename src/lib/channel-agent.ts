import { db } from './db'
import { llmChat } from './ai'
import { buildKnowledgeContext } from './knowledge'

/**
 * Auto-respuesta del agente IA para canales entrantes (Telegram / Instagram).
 * Si el cliente pide un humano (handoff keywords) no responde con IA y notifica
 * al equipo. Si responde, delega el envío al callback `send`.
 */

export async function llmReplyOrNotification(opts: {
  orgId: string
  clientId: string | null
  channelLabel: string
  incomingText: string
  handoffKeywords: string[]
  nichoContext: string
  send: (reply: string) => Promise<void>
}): Promise<{ replied: boolean; handoff: boolean; reply?: string }> {
  const { orgId, clientId, channelLabel, incomingText, handoffKeywords, nichoContext, send } = opts
  const wantsHuman = handoffKeywords.some((k) => incomingText.toLowerCase().includes(k.toLowerCase()))

  if (wantsHuman) {
    await db.notification.create({
      data: {
        organizationId: orgId,
        type: 'integration',
        title: `${channelLabel}: el cliente pide un humano`,
        body: incomingText.slice(0, 200),
        data: JSON.stringify({ clientId, channel: channelLabel.toLowerCase() }),
      },
    })
    return { replied: false, handoff: true }
  }

  try {
    const knowledgeContext = await buildKnowledgeContext(orgId)
    const reply = await llmChat(
      orgId,
      [
        {
          role: 'system',
          content: `Eres el agente comercial por ${channelLabel} de un negocio. Responde SIEMPRE en español, breve (máx 3 oraciones), cordial y orientado a agendar una cita o cotizar.\n\nCONTEXTO DEL NEGOCIO:\n${nichoContext}${knowledgeContext}\n\nResponde solo con el texto del mensaje; sin comillas ni prefijos.`,
        },
        { role: 'user', content: incomingText },
      ],
      { temperature: 0.5 }
    )
    if (reply.trim()) {
      await send(reply.trim())
      return { replied: true, handoff: false, reply: reply.trim() }
    }
    return { replied: false, handoff: false }
  } catch (err) {
    console.error('[channel-agent] auto-respuesta IA falló', err)
    return { replied: false, handoff: false }
  }
}
