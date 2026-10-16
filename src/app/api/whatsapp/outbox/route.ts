import type { NextRequest } from 'next/server'
import { json } from '@/lib/api-helpers'
import { dispatchWhatsAppOutboxBatch } from '@/lib/whatsapp-outbox'

/**
 * Internal retry worker for durable WhatsApp Cloud API deliveries.
 * Invoke periodically from the host scheduler using X-Internal-Secret.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_API_SECRET || ''
  const provided = req.headers.get('x-internal-secret') || ''
  if (!expected || !provided || provided !== expected) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await dispatchWhatsAppOutboxBatch(20)
    return json({ ok: true, ...result })
  } catch (error) {
    console.error('[whatsapp outbox] worker failed', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false }, { status: 500 })
  }
}
