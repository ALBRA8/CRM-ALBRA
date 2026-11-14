import { db } from './db'

/**
 * Programador de tareas durables (recomendación de auditoría #6: sustituir
 * el setInterval frágil por un runner con estado en BD e idempotencia).
 *
 * - Las automatizaciones con triggerType="schedule" guardan nextRunAt.
 * - `runDueJobs()` las ejecuta de forma idempotente (marca nextRunAt ANTES
 *   de ejecutar para evitar duplicados en reinicios).
 * - Se invoca desde instrumentation.ts (arranque del server) y desde
 *   POST /api/cron/run (para cron externo en producción).
 */

let running = false

/** Umbral de huérfanos: un 'running' más viejo que esto se considera muerto. */
export const STALE_RUNNING_MS = 10 * 60_000

/**
 * @param opts.orgId  Scope de tenant (plan v1.0 ARC-03 / P-03): cuando se
 *   define, SOLO se procesan automatizaciones y runs de esa organización.
 *   El cron externo con CRON_SECRET (operador del sistema) corre global;
 *   una sesión de admin de un tenant NUNCA debe disparar trabajo global.
 */
export async function runDueJobs(opts?: { orgId?: string }): Promise<{ processed: number; results: unknown[] }> {
  const orgId = opts?.orgId
  if (running) return { processed: 0, results: [] } // un solo worker a la vez
  running = true
  const results: unknown[] = []
  try {
    const now = new Date()

    // 0) Recuperación conservadora de runs interrumpidos.
    // Solo se reanuda un run nuevo con ledger habilitado y todos sus pasos
    // previamente confirmados como succeeded. Un paso started/unknown es
    // ambiguo; runs históricos (ledgerVersion=0) tampoco se reejecutan.
    let recovered = 0
    try {
      const cutoff = new Date(Date.now() - STALE_RUNNING_MS)
      const staleRuns = await db.automationRun.findMany({
        where: {
          status: { in: ['running', 'processing'] },
          startedAt: { lt: cutoff },
          ...(orgId ? { organizationId: orgId } : {}),
        },
        take: 50,
      })

      for (const stale of staleRuns) {
        const steps = await db.workflowStepExecution.findMany({
          where: { automationRunId: stale.id },
          orderBy: { stepIndex: 'asc' },
        })
        const safeToResume = stale.stepLedgerVersion === 1 && steps.every((step) => step.status === 'succeeded')
        if (!safeToResume) {
          if (steps.some((step) => step.status === 'started')) {
            await db.workflowStepExecution.updateMany({
              where: { automationRunId: stale.id, status: 'started' },
              data: { status: 'unknown', error: 'interrupted: resultado no verificable; no reintentar', finishedAt: new Date() },
            })
          }
          await db.automationRun.updateMany({
            where: { id: stale.id, status: { in: ['running', 'processing'] }, startedAt: { lt: cutoff } },
            data: {
              status: 'failed',
              error: stale.stepLedgerVersion === 1
                ? 'interrumpido: existe un paso con resultado ambiguo; requiere revisión'
                : 'interrumpido: run histórico sin ledger de pasos; no se reejecuta automáticamente',
              finishedAt: new Date(),
            },
          })
          continue
        }

        const automation = await db.automation.findFirst({
          where: { id: stale.automationId, organizationId: stale.organizationId, isActive: true },
        })
        if (!automation) {
          await db.automationRun.updateMany({
            where: { id: stale.id, status: { in: ['running', 'processing'] }, startedAt: { lt: cutoff } },
            data: { status: 'failed', error: 'interrumpido: automatización inactiva; no se reanudó', finishedAt: new Date() },
          })
          continue
        }

        const claim = await db.automationRun.updateMany({
          where: { id: stale.id, status: { in: ['running', 'processing'] }, startedAt: { lt: cutoff } },
          data: { status: 'running', startedAt: new Date(), finishedAt: null, error: null },
        })
        if (claim.count === 0) continue

        try {
          const payload = stale.input ? JSON.parse(stale.input) as Record<string, unknown> : {}
          const { runWorkflowsForTrigger } = await import('./workflow-engine')
          const out = await runWorkflowsForTrigger({
            orgId: stale.organizationId,
            type: automation.triggerType as 'client_created' | 'opportunity_stage_changed' | 'message_received' | 'reservation_created' | 'quote_status_changed' | 'schedule',
            payload,
            automationId: automation.id,
            existingRunId: stale.id,
          })
          results.push({ automationId: automation.id, recoveredRunId: stale.id, out })
          recovered++
        } catch (err) {
          console.error('[scheduler] fallo recuperando run', stale.id, err)
        }
      }
    } catch (err) {
      console.error('[scheduler] fallo recuperación de runs interrumpidos', err)
    }

    // 1) Reanudar runs en espera cuyo "Esperar" venció (patrón DELAY de Twenty)
    let resumed = 0
    try {
      const { resumeWaitingRuns } = await import('./workflow-engine')
      resumed = await resumeWaitingRuns(orgId ? { orgId } : undefined)
      if (resumed > 0) console.log(`[scheduler] runs reanudados: ${resumed}`)
    } catch (err) {
      console.error('[scheduler] fallo reanudando runs en espera', err)
    }

    // 2) Automatizaciones programadas vencidas (scope de tenant si aplica)
    const due = await db.automation.findMany({
      where: {
        isActive: true,
        triggerType: 'schedule',
        nextRunAt: { lte: now },
        ...(orgId ? { organizationId: orgId } : {}),
      },
      take: 25,
    })

    let claimed = 0
    for (const automation of due) {
      // CLAIM + run durable en una sola transacción: si falla la creación del
      // run, también se revierte el avance de nextRunAt. Así no se pierde el
      // disparo entre ambas escrituras.
      const intervalMinutes = intervalFromConfig(automation.triggerConfig)
      const next = new Date(now.getTime() + intervalMinutes * 60_000)
      const scheduledAt = now.toISOString()
      const payload = { automationId: automation.id, scheduledAt }
      let durableRunId: string | null = null
      try {
        durableRunId = await db.$transaction(async (tx) => {
          const claim = await tx.automation.updateMany({
            where: {
              id: automation.id,
              organizationId: automation.organizationId,
              isActive: true,
              triggerType: 'schedule',
              nextRunAt: { lte: now },
            },
            data: { nextRunAt: next },
          })
          if (claim.count === 0) return null
          const run = await tx.automationRun.create({
            data: {
              organizationId: automation.organizationId,
              automationId: automation.id,
              input: JSON.stringify(payload).slice(0, 5000),
              stepLedgerVersion: 1,
              idempotencyKey: `schedule:${scheduledAt}`.slice(0, 180),
            },
          })
          return run.id
        })
      } catch (err) {
        console.error('[scheduler] fallo creando claim/run durable', automation.id, err)
        continue
      }
      if (!durableRunId) continue
      claimed++

      try {
        const { runWorkflowsForTrigger } = await import('./workflow-engine')
        const out = await runWorkflowsForTrigger({
          orgId: automation.organizationId,
          type: 'schedule',
          payload,
          automationId: automation.id,
          existingRunId: durableRunId,
        })
        results.push({ automationId: automation.id, out })
      } catch (err) {
        console.error('[scheduler] fallo ejecutando', automation.id, err)
      }
    }
    return { processed: claimed + resumed + recovered, results }
  } finally {
    running = false
  }
}

function intervalFromConfig(triggerConfig: string | null): number {
  try {
    if (!triggerConfig) return 60
    const cfg = JSON.parse(triggerConfig)
    const minutes = Number(cfg.intervalMinutes)
    return Number.isFinite(minutes) && minutes >= 5 ? minutes : 60
  } catch {
    return 60
  }
}
