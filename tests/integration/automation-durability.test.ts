import { describe, expect, it, vi } from 'vitest'

/**
 * DURABILIDAD DE AUTOMATIZACIONES (§14 del cierre): idempotencia ante
 * reentregas, claim atómico del scheduler y sweeper de runs huérfanos.
 * El setup global mockea '@/lib/workflow-engine' (blindaje de canales);
 * aquí usamos el motor REAL vía importActual para probar sus garantías.
 */
const real = await vi.importActual<typeof import('@/lib/workflow-engine')>('@/lib/workflow-engine')
import { runDueJobs } from '@/lib/scheduler'
import { db } from '@/lib/db'

const AUTOMATION_BASE = {
  organizationId: 'org-a',
  conditions: '[]',
  actions: '[]',
  isActive: true,
}

describe('idempotencia de runs (webhook re-entregado ≠ doble ejecución)', () => {
  it('el mismo evento dos veces → el segundo es deduplicated (1 solo run)', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Idem', triggerType: 'client_created' } })
    try {
      const payload = { id: 'client-a1', name: 'Cliente Alpha' }
      const r1 = await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      const r2 = await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      expect(r1[0]?.status).toBe('success')
      expect(r2[0]?.status).toBe('deduplicated')
      const runs = await db.automationRun.count({ where: { automationId: auto.id } })
      expect(runs).toBe(1)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('eventos distintos del mismo tipo SÍ ejecutan (claves distintas)', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Idem multi', triggerType: 'client_created' } })
    try {
      await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload: { id: 'client-a1' } })
      await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload: { id: 'client-a2' } })
      const runs = await db.automationRun.count({ where: { automationId: auto.id } })
      expect(runs).toBe(2)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('re-entrega del MISMO evento minutos después sigue deduplicada (garantía permanente)', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Idem ventana', triggerType: 'client_created' } })
    try {
      const payload = { id: 'client-a1' }
      await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      // Envejece el run 3 minutos: la re-entrega del MISMO eventId SIGUE siendo
      // el mismo evento → no vuelve a ejecutar (doble WhatsApp jamás).
      await db.automationRun.updateMany({
        where: { automationId: auto.id },
        data: { startedAt: new Date(Date.now() - 180_000) },
      })
      const again = await real.runWorkflowsForTrigger({ orgId: 'org-a', type: 'client_created', payload })
      expect(again[0]?.status).toBe('deduplicated')
      const runs = await db.automationRun.count({ where: { automationId: auto.id } })
      expect(runs).toBe(1)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})

describe('scheduler: claim atómico y recovery', () => {
  it('runDueJobs ejecuta UNA vez y mueve nextRunAt; el segundo pase no repite', async () => {
    const auto = await db.automation.create({
      data: { ...AUTOMATION_BASE, name: 'Sched', triggerType: 'schedule', triggerConfig: '{"intervalMinutes":60}', nextRunAt: new Date(Date.now() - 60_000) },
    })
    try {
      const first = await runDueJobs()
      expect(first.processed).toBeGreaterThanOrEqual(1)
      const after = await db.automation.findUnique({ where: { id: auto.id } })
      expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.now()) // ya no está vencida
      const second = await runDueJobs()
      const scheduleRunsSecond = (second.results as Array<{ automationId?: string }>).filter((r) => r.automationId === auto.id).length
      expect(scheduleRunsSecond).toBe(0)
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('sweeper: runs running huérfanos (crash) quedan failed al pasar el scheduler', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Orfan', triggerType: 'client_created' } })
    const run = await db.automationRun.create({
      data: { organizationId: 'org-a', automationId: auto.id, status: 'running', startedAt: new Date(Date.now() - 20 * 60_000) },
    })
    try {
      await runDueJobs()
      const after = await db.automationRun.findUnique({ where: { id: run.id } })
      expect(after!.status).toBe('failed')
      expect(after!.error).toContain('interrupted')
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })

  it('resumeWaitingRuns: solo una instancia reanuda; tras reanudar, no re-procesa', async () => {
    const auto = await db.automation.create({ data: { ...AUTOMATION_BASE, name: 'Wait', triggerType: 'client_created' } })
    const run = await db.automationRun.create({
      data: { organizationId: 'org-a', automationId: auto.id, status: 'waiting', input: '{}', currentStep: 0, resumeAt: new Date(Date.now() - 1000) },
    })
    try {
      const n1 = await real.resumeWaitingRuns()
      expect(n1).toBeGreaterThanOrEqual(1)
      const n2 = await real.resumeWaitingRuns()
      expect(n2).toBe(0) // ya no hay runs vencidos: no se re-ejecuta dos veces
      const after = await db.automationRun.findUnique({ where: { id: run.id } })
      expect(after!.status).toBe('success')
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})
