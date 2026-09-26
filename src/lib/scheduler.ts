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

export async function runDueJobs(): Promise<{ processed: number; results: unknown[] }> {
  if (running) return { processed: 0, results: [] } // un solo worker a la vez
  running = true
  const results: unknown[] = []
  try {
    const now = new Date()

    // 1) Reanudar runs en espera cuyo "Esperar" venció (patrón DELAY de Twenty)
    let resumed = 0
    try {
      const { resumeWaitingRuns } = await import('./workflow-engine')
      resumed = await resumeWaitingRuns()
      if (resumed > 0) console.log(`[scheduler] runs reanudados: ${resumed}`)
    } catch (err) {
      console.error('[scheduler] fallo reanudando runs en espera', err)
    }

    // 2) Automatizaciones programadas vencidas
    const due = await db.automation.findMany({
      where: { isActive: true, triggerType: 'schedule', nextRunAt: { lte: now } },
      take: 25,
    })

    for (const automation of due) {
      // marcar próxima ejecución antes de correr (idempotencia ante reinicios)
      const intervalMinutes = intervalFromConfig(automation.triggerConfig)
      const next = new Date(Date.now() + intervalMinutes * 60_000)
      await db.automation.update({ where: { id: automation.id }, data: { nextRunAt: next } })

      try {
        const { runWorkflowsForTrigger } = await import('./workflow-engine')
        const out = await runWorkflowsForTrigger({
          orgId: automation.organizationId,
          type: 'schedule',
          payload: { automationId: automation.id, scheduledAt: now.toISOString() },
        })
        results.push({ automationId: automation.id, out })
      } catch (err) {
        console.error('[scheduler] fallo ejecutando', automation.id, err)
      }
    }
    return { processed: due.length + resumed, results }
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
