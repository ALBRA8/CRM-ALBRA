import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runDueJobs } from '@/lib/scheduler'
import { db } from '@/lib/db'
import { FIX } from '../helpers'

/**
 * Recuperación durable del scheduler (Task 25):
 * - Un run 'running' huérfano (servidor reiniciado a mitad de ejecución) se
 *   marca 'failed' con error descriptivo en el siguiente tick.
 * - Un run 'running' reciente NO se toca (podría estar ejecutándose de verdad).
 * - Un run 'waiting' con DELAY futuro NO se toca (ese lo reanuda
 *   resumeWaitingRuns cuando venza resumeAt, cubierto por el motor).
 */

let automationId: string
let staleId: string
let freshId: string
let waitingId: string

const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000)

beforeAll(async () => {
  const automation = await db.automation.create({
    data: {
      organizationId: FIX.orgA.id,
      name: 'Auto — scheduler recovery',
      triggerType: 'manual', // manual+inactiva: el barrido de schedule no la toca
      isActive: false,
    },
  })
  automationId = automation.id

  staleId = (
    await db.automationRun.create({
      data: {
        organizationId: FIX.orgA.id,
        automationId,
        status: 'running',
        startedAt: minutesAgo(11), // > STALE_RUNNING_MS (10 min)
      },
    })
  ).id

  freshId = (
    await db.automationRun.create({
      data: {
        organizationId: FIX.orgA.id,
        automationId,
        status: 'running',
        startedAt: minutesAgo(1),
      },
    })
  ).id

  waitingId = (
    await db.automationRun.create({
      data: {
        organizationId: FIX.orgA.id,
        automationId,
        status: 'waiting',
        startedAt: minutesAgo(30),
        resumeAt: new Date(Date.now() + 24 * 60 * 60_000), // DELAY futuro
      },
    })
  ).id
})

afterAll(async () => {
  await db.automationRun.deleteMany({ where: { automationId } })
  await db.automation.deleteMany({ where: { id: automationId } })
  await db.$disconnect()
})

describe('runDueJobs — recuperación de runs huérfanos', () => {
  it("marca 'running' antiguo como failed con error claro", async () => {
    await runDueJobs()
    const stale = await db.automationRun.findUnique({ where: { id: staleId } })
    expect(stale?.status).toBe('failed')
    expect(String(stale?.error)).toContain('interrumpido')
    expect(stale?.finishedAt).not.toBeNull()
  })

  it('NO toca un run running reciente ni un waiting con DELAY futuro', async () => {
    const fresh = await db.automationRun.findUnique({ where: { id: freshId } })
    expect(fresh?.status).toBe('running')

    const waiting = await db.automationRun.findUnique({ where: { id: waitingId } })
    expect(waiting?.status).toBe('waiting')
    expect(waiting?.finishedAt).toBeNull()
  })

  it('es idempotente: un segundo tick no altera nada', async () => {
    await runDueJobs()
    const stale = await db.automationRun.findUnique({ where: { id: staleId } })
    expect(stale?.status).toBe('failed')
    const waiting = await db.automationRun.findUnique({ where: { id: waitingId } })
    expect(waiting?.status).toBe('waiting')
  })
})
