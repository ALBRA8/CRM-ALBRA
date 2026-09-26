import type { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { runDueJobs } from '@/lib/scheduler'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * POST /api/automations/run — ejecuta los trabajos vencidos del scheduler
 * (runDueJobs) y devuelve contadores HONESTOS de esta invocación (Task 19-b):
 *   - processed:      trabajos vencidos procesados + runs reanudados (scheduler)
 *   - results:        { runsTriggered, succeeded, failed } — cada entrada de
 *                     runWorkflowsForTrigger es un run real con su estado
 *                     (success | skipped | waiting | failed); skipped/waiting
 *                     cuentan en runsTriggered pero ni como éxito ni fallo.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    // Fase 2 RBAC: disparar el scheduler manualmente es operación administrativa
    const auth = requirePermission(req, 'automations.run')
    const { processed, results } = await runDueJobs()

    // Contadores honestos: se cuentan los runs REALES ejecutados en esta
    // invocación, con el estado que reporta el motor de workflows.
    const runOutcomes = (results as Array<{ out?: Array<{ status?: string }> }>).flatMap(
      (item) => (Array.isArray(item.out) ? item.out : [])
    )
    const runsTriggered = runOutcomes.length
    const succeeded = runOutcomes.filter((r) => r.status === 'success').length
    const failed = runOutcomes.filter((r) => r.status === 'failed').length

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'ran_automation',
      entity: 'automation',
      details: { processed, runsTriggered, succeeded, failed },
    })

    return json({
      processed,
      results: { runsTriggered, succeeded, failed },
      runs: results,
    })
  })
}
