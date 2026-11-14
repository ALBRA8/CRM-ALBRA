import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'

/**
 * Legacy Gmail send endpoint disabled: Gmail delivery is not yet implemented
 * by the canonical workflow outbox dispatcher. Do not bypass its kill-switch.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAuth(req)
    return json({
      error: 'El envío directo por Gmail está deshabilitado hasta integrar Gmail con la outbox canónica.',
      code: 'LEGACY_GMAIL_SEND_DISABLED',
    }, { status: 409 })
  })
}
