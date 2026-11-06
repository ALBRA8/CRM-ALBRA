import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { sendInboxMessage, parseInboxKey, parseWaNewKey } from '@/lib/inbox'
import { rememberMessage, maybeConsolidate } from '@/lib/memory'

/**
 * POST /api/inbox/send — envía un mensaje por el canal de la conversación.
 * Body: { key, contactHandle, clientId?, text }.
 *  - wa:<convId>       → daemon Baileys ({ to, text }, secreto server-to-server)
 *  - wa-new:<teléfono> → daemon Baileys + find-or-create de la conversación
 *                        (Task 19-b: cliente con teléfono y sin conversación)
 *  - tg:<clientId>     → Telegram Bot API (chatId = contactHandle) + timeline
 *  - ig:<clientId>     → Instagram Graph API (recipientId = contactHandle) + timeline
 * Graceful: canal sin configurar → 400 descriptivo (nunca 500).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as {
      key?: string
      contactHandle?: string
      clientId?: string | null
      text?: string
    }
    requireFields(body as unknown as Record<string, unknown>, ['key', 'text'])
    const key = String(body.key)
    if (!parseInboxKey(key) && !parseWaNewKey(key)) {
      return json({ error: 'Conversación inválida' }, { status: 400 })
    }

    const result = await sendInboxMessage({
      orgId: auth.orgId,
      userId: auth.userId,
      key,
      contactHandle: String(body.contactHandle || ''),
      // (segunda reparación §2.B) El cliente referenciado debe existir y pertenecer
      // a la organización del remitente — jamás se acepta un id de otra org.
      clientId: await (async () => {
        const clientId = body.clientId || null
        if (!clientId) return null
        const c = await db.client.findFirst({ where: { id: String(clientId), organizationId: auth.orgId }, select: { id: true } })
        if (!c) return null
        return String(clientId)
      })(),
      text: String(body.text || ''),
    })
    if (!result.ok) return json({ error: result.error }, { status: 400 })
    // Memoria vectorial (Fase 5): el mensaje saliente del vendedor también
    // alimenta el recuerdo del cliente. Fire-and-forget: nunca bloquea el envío.
    const channel = key.startsWith('wa') ? 'whatsapp' : key.startsWith('tg') ? 'telegram' : 'instagram'
    const safeClientId = body.clientId && (await db.client.findFirst({ where: { id: String(body.clientId), organizationId: auth.orgId }, select: { id: true } })) ? String(body.clientId) : null
    void rememberMessage({ orgId: auth.orgId, clientId: safeClientId, channel, role: 'outgoing', text: String(body.text || '') })
    maybeConsolidate(auth.orgId, safeClientId)
    return json({ success: true, sent: true })
  })
}
