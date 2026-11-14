import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'

/**
 * Messenger legacy direct-send endpoint.
 * All provider sends must be queued through the canonical outbound pipeline.
 * This compatibility route intentionally fails closed until migrated.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { recipientId?: string; text?: string; clientId?: string }
    requireFields(body as unknown as Record<string, unknown>, ['recipientId', 'text'])
    return json({
      error: 'El envío directo legacy está deshabilitado; usa una conversación canónica de la outbox.',
      code: 'LEGACY_PROVIDER_SEND_DISABLED',
    }, { status: 409 })
  })
}
