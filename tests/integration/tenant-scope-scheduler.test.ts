import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { runDueJobs } from '@/lib/scheduler'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import type { resumeWaitingRuns as realResumeWaitingRunsType } from '@/lib/workflow-engine'
import { db } from '@/lib/db'
import { FIX } from '../helpers'

/**
 * Package A del plan v1.0 — aislamiento de dos organizaciones en el scheduler
 * (P-03: "operaciones globales disparables con contexto de tenant").
 *
 * Contrato:
 * - runDueJobs({ orgId }) SOLO procesa (claim de nextRunAt, sweeper de runs
 *   huérfanos y reanudación de 'waiting') lo de ESA organización.
 * - runDueJobs() sin scope (vía x-cron-secret, operador del sistema) sigue
 *   procesando todo — no se rompe el cron externo de producción.
 * - La sesión de un admin de tenant (POST /api/cron/run y
 *   /api/automations/run) pasa SIEMPRE su orgId: un tenant no puede disparar
 *   trabajo de otro (cobertura de ruta: los handlers invocan runDueJobs con
 *   { orgId: auth.orgId } — este archivo prueba el contrato del scheduler,
 *   la pieza no-op mockeada globalmente es el motor de envíos).
 */

let autoScheduleA: string
let autoScheduleB: string
let autoManualA: string
let autoManualB: string

const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000)
const minutesFromNow = (n: number): Date => new Date(Date.now() + n * 60_000)

beforeAll(async () => {
  // Automatizaciones programadas VENCIDAS en A y B (candidatas a claim)
  autoScheduleA = (
    await db.automation.create({
      data: {
        organizationId: FIX.orgA.id,
        name: 'Tenant-scope — schedule A',
        triggerType: 'schedule',
        isActive: true,
        nextRunAt: minutesAgo(5),
      },
    })
  ).id
  autoScheduleB = (
    await db.automation.create({
      data: {
        organizationId: FIX.orgB.id,
        name: 'Tenant-scope — schedule B',
        triggerType: 'schedule',
        isActive: true,
        nextRunAt: minutesAgo(5),
      },
    })
  ).id

  // Automatizaciones manuales para colgar runs huérfanos y waiting
  autoManualA = (
    await db.automation.create({
      data: { organizationId: FIX.orgA.id, name: 'Tenant-scope — manual A', triggerType: 'manual', isActive: true },
    })
  ).id
  autoManualB = (
    await db.automation.create({
      data: { organizationId: FIX.orgB.id, name: 'Tenant-scope — manual B', triggerType: 'manual', isActive: true },
    })
  ).id
})

afterAll(async () => {
  for (const id of [autoScheduleA, autoScheduleB, autoManualA, autoManualB]) {
    await db.automationRun.deleteMany({ where: { automationId: id } })
    await db.automation.deleteMany({ where: { id } })
  }
  await db.$disconnect()
})

describe('runDueJobs — scope de tenant (plan v1.0 P-03 / ARC-03)', () => {
  it('un disparo schedule con automationId no ejecuta otras automatizaciones del mismo tenant', async () => {
    const other = await db.automation.create({
      data: {
        organizationId: FIX.orgA.id,
        name: 'Tenant-scope — schedule sibling',
        triggerType: 'schedule',
        isActive: true,
        actions: '[]',
      },
    })
    try {
      const beforeTarget = await db.automationRun.count({ where: { automationId: autoScheduleA } })
      const beforeOther = await db.automationRun.count({ where: { automationId: other.id } })
      await runWorkflowsForTrigger({
        orgId: FIX.orgA.id,
        type: 'schedule',
        automationId: autoScheduleA,
        payload: { automationId: autoScheduleA, scheduledAt: new Date().toISOString() },
      })
      const afterTarget = await db.automationRun.count({ where: { automationId: autoScheduleA } })
      const afterOther = await db.automationRun.count({ where: { automationId: other.id } })
      expect(afterTarget).toBe(beforeTarget + 1)
      expect(afterOther).toBe(beforeOther)
    } finally {
      await db.automationRun.deleteMany({ where: { automationId: other.id } })
      await db.automation.delete({ where: { id: other.id } })
    }
  })

  it('con orgId=A SOLO reclama la automatización vencida de A; la de B sigue vencida', async () => {
    const runsBeforeA = await db.automationRun.count({ where: { automationId: autoScheduleA } })
    const runsBeforeB = await db.automationRun.count({ where: { automationId: autoScheduleB } })
    const { processed } = await runDueJobs({ orgId: FIX.orgA.id })
    expect(processed).toBeGreaterThanOrEqual(1)

    const runsAfterA = await db.automationRun.count({ where: { automationId: autoScheduleA } })
    const runsAfterB = await db.automationRun.count({ where: { automationId: autoScheduleB } })
    expect(runsAfterA).toBe(runsBeforeA + 1) // claim y run quedan persistidos
    expect(runsAfterB).toBe(runsBeforeB) // ningún run de otro tenant

    const a = await db.automation.findUnique({ where: { id: autoScheduleA } })
    const b = await db.automation.findUnique({ where: { id: autoScheduleB } })
    // A fue reclamada: nextRunAt movido al futuro (intervalo por defecto 60 min)
    expect(a?.nextRunAt).not.toBeNull()
    expect(a!.nextRunAt!.getTime()).toBeGreaterThan(Date.now())
    // B NO fue tocada: su nextRunAt sigue en el pasado (vencida, disponible para su propio tick)
    expect(b?.nextRunAt).not.toBeNull()
    expect(b!.nextRunAt!.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('el sweeper con scope=A solo marca huérfanos de A; el de B queda intacto', async () => {
    const staleA = await db.automationRun.create({
      data: { organizationId: FIX.orgA.id, automationId: autoManualA, status: 'running', startedAt: minutesAgo(11) },
    })
    const staleB = await db.automationRun.create({
      data: { organizationId: FIX.orgB.id, automationId: autoManualB, status: 'running', startedAt: minutesAgo(11) },
    })

    await runDueJobs({ orgId: FIX.orgA.id })

    const a = await db.automationRun.findUnique({ where: { id: staleA.id } })
    const b = await db.automationRun.findUnique({ where: { id: staleB.id } })
    expect(a?.status).toBe('failed')
    expect(String(a?.error)).toContain('interrumpido')
    expect(b?.status).toBe('running') // huérfano de B: SOLO el operador global o B lo toca

    await db.automationRun.delete({ where: { id: staleA.id } })
    await db.automationRun.delete({ where: { id: staleB.id } })
  })

  it('resumeWaitingRuns con scope=B solo reanuda el waiting de B (implementación real)', async () => {
    // Implementación REAL del motor (el mock global la sustituye para envíos)
    const engine = (await vi.importActual('@/lib/workflow-engine')) as {
      resumeWaitingRuns: typeof realResumeWaitingRunsType
    }

    const waitA = await db.automationRun.create({
      data: {
        organizationId: FIX.orgA.id,
        automationId: autoManualA,
        status: 'waiting',
        startedAt: minutesAgo(30),
        resumeAt: minutesAgo(1), // vencido → candidato a reanudación
      },
    })
    const waitB = await db.automationRun.create({
      data: {
        organizationId: FIX.orgB.id,
        automationId: autoManualB,
        status: 'waiting',
        startedAt: minutesAgo(30),
        resumeAt: minutesAgo(1),
      },
    })

    const resumed = await engine.resumeWaitingRuns({ orgId: FIX.orgB.id })
    expect(resumed).toBe(1)

    const b = await db.automationRun.findUnique({ where: { id: waitB.id } })
    expect(b?.status).toBe('success') // sin acciones → completado inmediato
    expect(b?.finishedAt).not.toBeNull()

    const a = await db.automationRun.findUnique({ where: { id: waitA.id } })
    expect(a?.status).toBe('waiting') // el waiting de A NO fue reanudado por B

    await db.automationRun.delete({ where: { id: waitA.id } })
    await db.automationRun.delete({ where: { id: waitB.id } })
  })

  it('runDueJobs GLOBAL (cron-secret, operador del sistema) sí procesa lo de B', async () => {
    // autoScheduleB sigue vencida (solo B no ha corrido su tick)
    const { processed } = await runDueJobs()
    expect(processed).toBeGreaterThanOrEqual(1)

    const b = await db.automation.findUnique({ where: { id: autoScheduleB } })
    expect(b!.nextRunAt!.getTime()).toBeGreaterThan(Date.now()) // ahora sí reclamada
  })

  it('reclama un run una sola vez y persiste el resultado durable del paso', async () => {
    const engine = await vi.importActual<typeof import('@/lib/workflow-engine')>('@/lib/workflow-engine')
    const title = 'Scheduler ledger concurrency test'
    const automation = await db.automation.create({
      data: {
        organizationId: FIX.orgA.id,
        name: 'Workflow ledger concurrency',
        triggerType: 'client_created',
        isActive: true,
        actions: JSON.stringify([{ type: 'create_task_like_notification', config: { title, body: 'ledger test' } }]),
      },
    })
    const run = await db.automationRun.create({
      data: {
        organizationId: FIX.orgA.id,
        automationId: automation.id,
        input: JSON.stringify({ id: 'ledger-test-event' }),
        stepLedgerVersion: 1,
      },
    })
    try {
      const event = {
        orgId: FIX.orgA.id,
        type: 'client_created' as const,
        payload: { id: 'ledger-test-event' },
        automationId: automation.id,
        existingRunId: run.id,
      }
      const results = await Promise.all([
        engine.runWorkflowsForTrigger(event),
        engine.runWorkflowsForTrigger(event),
      ])
      expect(results.flat().filter((item) => item.status === 'success')).toHaveLength(1)
      expect(results.flat().filter((item) => item.status === 'already_claimed')).toHaveLength(1)

      const persistedRun = await db.automationRun.findUnique({ where: { id: run.id } })
      const steps = await db.workflowStepExecution.findMany({ where: { automationRunId: run.id } })
      const notifications = await db.notification.count({
        where: { organizationId: FIX.orgA.id, title },
      })
      expect(persistedRun?.status).toBe('success')
      expect(steps).toHaveLength(1)
      expect(steps[0].status).toBe('succeeded')
      expect(notifications).toBe(1)
    } finally {
      await db.notification.deleteMany({ where: { organizationId: FIX.orgA.id, title } })
      await db.automationRun.deleteMany({ where: { id: run.id } })
      await db.automation.deleteMany({ where: { id: automation.id } })
    }
  })

})
