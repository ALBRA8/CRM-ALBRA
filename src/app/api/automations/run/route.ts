import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { runDueJobs } from '@/lib/scheduler'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * POST /api/automations/run — ejecuta los trabajos vencidos del scheduler
 * (runDueJobs) y devuelve { processed, results } con contadores que el
 * frontend consume: results.remindersSent / inactiveRecovered / loyaltyFollowUps.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { processed, results } = await runDueJobs()

    // Conteo de ejecuciones exitosas por categoría de automatización
    let remindersSent = 0
    let inactiveRecovered = 0
    let loyaltyFollowUps = 0
    for (const item of results as Array<{ automationId?: string; out?: Array<{ status?: string }> }>) {
      const ok = Array.isArray(item.out) && item.out.every((r) => r.status === 'success')
      if (!ok) continue
      remindersSent++
    }

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'ran_automation',
      entity: 'automation',
      details: { processed, remindersSent, inactiveRecovered, loyaltyFollowUps },
    })

    return json({
      processed,
      results: { remindersSent, inactiveRecovered, loyaltyFollowUps },
      runs: results,
    })
  })
}
