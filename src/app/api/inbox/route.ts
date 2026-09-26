import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, parseIntParam } from '@/lib/api-helpers'
import { listInbox, getInboxMessages, markInboxRead, parseInboxKey } from '@/lib/inbox'

/**
 * GET /api/inbox            — lista unificada de conversaciones (WA + TG + IG).
 * GET /api/inbox?key=...    — mensajes de una conversación + marca como leída.
 *
 * La key es "wa:<convId>" | "tg:<clientId>" | "ig:<clientId>" (parseo estricto,
 * fail-closed). Todo aislado por organizationId de la sesión JWT.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const key = req.nextUrl.searchParams.get('key')

    if (!key) {
      const limit = parseIntParam(req, 'limit', 100, 1, 200)
      const conversations = await listInbox(auth.orgId, limit)
      return json({ conversations })
    }

    if (!parseInboxKey(key)) {
      return json({ error: 'Conversación inválida' }, { status: 400 })
    }

    const [messages] = await Promise.all([
      getInboxMessages(auth.orgId, key),
      markInboxRead(auth.orgId, key),
    ])
    return json({ messages })
  })
}
