import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'

/**
 * TikTok direct-send is deliberately fail-closed.
 *
 * The canonical channel outbox does not yet support TikTok, and the inbound
 * webhook does not persist a verified provider conversation identity in a
 * canonical conversation. Sending directly from this route would bypass
 * durable intent, idempotency, reconciliation and operator audit.
 *
 * Keep the endpoint for API compatibility, but do not contact TikTok until
 * the approved Business Messaging contract and canonical outbox adapter are
 * implemented and covered by integration tests.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAdmin(req)
    return json({
      ok: false,
      code: 'TIKTOK_OUTBOX_NOT_IMPLEMENTED',
      error: 'El envío de TikTok está temporalmente bloqueado hasta completar la integración con la outbox canónica.',
    }, { status: 503 })
  })
}
