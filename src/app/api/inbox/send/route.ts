import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { sendInboxMessage, parseInboxKey, parseWaNewKey } from '@/lib/inbox'

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
    const auth = requireAuth(req)
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
      clientId: body.clientId || null,
      text: String(body.text || ''),
    })
    if (!result.ok) return json({ error: result.error }, { status: 400 })
    return json({ success: true, sent: true })
  })
}
