import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'

/**
 * Legacy manual SMTP endpoint disabled until manual email intents use the
 * canonical encrypted workflow outbox and its idempotency contract.
 * Workflow email actions remain separate and are dispatched only by the
 * guarded workflow-outbox worker.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    await requireAuth(req)
    return json({
      error: 'El envío manual de correo SMTP está temporalmente deshabilitado hasta migrarlo a la outbox canónica.',
      code: 'LEGACY_EMAIL_SEND_DISABLED',
    }, { status: 409 })
  })
}
