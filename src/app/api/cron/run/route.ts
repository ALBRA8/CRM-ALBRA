import type { NextRequest } from 'next/server'
import { handle, json } from '@/lib/api-helpers'
import { requireAuth } from '@/lib/auth'
import { runDueJobs } from '@/lib/scheduler'

/**
 * POST /api/cron/run — para cron externo en producción.
 * - Público con header x-cron-secret === APP_SECRET
 * - o sesión de admin (requireAuth + isAdmin)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const cronSecret = process.env.APP_SECRET
    const provided = req.headers.get('x-cron-secret')
    if (cronSecret && provided && provided === cronSecret) {
      const { processed, results } = await runDueJobs()
      return json({ processed, runs: results, via: 'cron-secret' })
    }
    const auth = requireAuth(req)
    if (!auth.isAdmin) return json({ error: 'Se requieren permisos de administrador' }, { status: 403 })
    const { processed, results } = await runDueJobs()
    return json({ processed, runs: results, via: 'session' })
  })
}
