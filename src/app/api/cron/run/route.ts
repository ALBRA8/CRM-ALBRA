import type { NextRequest } from 'next/server'
import { handle, json } from '@/lib/api-helpers'
import { requireAuth } from '@/lib/auth'
import { safeEquals } from '@/lib/integrations'
import { runDueJobs } from '@/lib/scheduler'

/**
 * POST /api/cron/run — para cron externo en producción.
 * - Público con header x-cron-secret === APP_SECRET
 * - o sesión de admin (requireAuth + isAdmin)
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    // Seguro independiente del APP_SECRET (que firma JWTs): si CRON_SECRET
    // está definido se usa él; comparación constant-time (auditoría #7).
    const cronSecret = process.env.CRON_SECRET || process.env.APP_SECRET
    const provided = req.headers.get('x-cron-secret')
    if (cronSecret && provided && safeEquals(provided, cronSecret)) {
      const { processed, results } = await runDueJobs()
      return json({ processed, runs: results, via: 'cron-secret' })
    }
    const auth = requireAuth(req)
    if (!auth.isAdmin) return json({ error: 'Se requieren permisos de administrador' }, { status: 403 })
    const { processed, results } = await runDueJobs()
    return json({ processed, runs: results, via: 'session' })
  })
}
