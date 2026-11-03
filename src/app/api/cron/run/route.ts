import type { NextRequest } from 'next/server'
import { handle, json } from '@/lib/api-helpers'
import { requireAuth } from '@/lib/auth'
import { safeEquals } from '@/lib/integrations'
import { runDueJobs } from '@/lib/scheduler'

/**
 * POST /api/cron/run — para cron externo en producción.
 * - Público con header x-cron-secret === CRON_SECRET|APP_SECRET → run GLOBAL
 *   (operador del sistema).
 * - o sesión de admin → run con SCOPE DE TENANT (plan v1.0 P-03): un admin
 *   de una organización solo dispara las automatizaciones de SU org, nunca
 *   trabajo global de otros tenants.
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
    const { processed, results } = await runDueJobs({ orgId: auth.orgId })
    return json({ processed, runs: results, via: 'session', orgId: auth.orgId })
  })
}
