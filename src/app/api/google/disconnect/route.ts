import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { clearGoogleConnection } from '@/lib/google'
import { auditAndTimeline } from '@/lib/api-helpers'

/** POST /api/google/disconnect — revoca la conexión local (borra refresh token) */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    await clearGoogleConnection(auth.orgId)
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'google', disconnected: true },
    })
    return json({ success: true, connected: false })
  })
}
