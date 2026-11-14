import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runDueJobs } from '@/lib/scheduler'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { db } from '@/lib/db'
import { FIX } from '../helpers'

let triggerAutomationId: string
let recoveryAutomationId: string
let recoveredRunId: string
let originalLeaseToken: string

beforeAll(async () => {
  const triggerAutomation = await db.automation.create({
    data: {
      organizationId: FIX.orgA.id,
      name: 'Workflow lease concurrent claim',
      triggerType: 'client_created',
      isActive: true,
      actions: '[]',
    },
  })
  triggerAutomationId = triggerAutomation.id

  const recoveryAutomation = await db.automation.create({
    data: {
      organizationId: FIX.orgA.id,
      name: 'Workflow lease stale reclaim',
      triggerType: 'manual',
      isActive: true,
      actions: '[]',
    },
  })
  recoveryAutomationId = recoveryAutomation.id

  originalLeaseToken = 'old-worker-lease-token'
  const oldRun = await db.automationRun.create({
    data: {
      organizationId: FIX.orgA.id,
      automationId: recoveryAutomationId,
      status: 'running',
      startedAt: new Date(Date.now() - 20 * 60_000),
      stepLedgerVersion: 1,
      leaseToken: originalLeaseToken,
      leaseExpiresAt: new Date(Date.now() - 5 * 60_000),
      fencingVersion: 1,
    },
  })
  recoveredRunId = oldRun.id
  await db.workflowStepExecution.create({
    data: {
      automationRunId: recoveredRunId,
      stepIndex: 0,
      actionType: 'notify_admin',
      status: 'succeeded',
      output: JSON.stringify({ notified: true }),
      finishedAt: new Date(Date.now() - 15 * 60_000),
    },
  })
})

afterAll(async () => {
  await db.automationRun.deleteMany({
    where: { automationId: { in: [triggerAutomationId, recoveryAutomationId] } },
  })
  await db.automation.deleteMany({
    where: { id: { in: [triggerAutomationId, recoveryAutomationId] } },
  })
  await db.$disconnect()
})

describe('distributed workflow run leases', () => {
  it('permits only one concurrent claim for the same idempotent trigger', async () => {
    const event = {
      orgId: FIX.orgA.id,
      type: 'client_created' as const,
      payload: { id: 'lease-concurrency-fixture' },
      automationId: triggerAutomationId,
    }

    const [first, second] = await Promise.all([
      runWorkflowsForTrigger(event),
      runWorkflowsForTrigger(event),
    ])

    expect([...first, ...second].some((result) => result.status === 'success'), JSON.stringify({ first, second })).toBe(true)
    const runs = await db.automationRun.findMany({
      where: { automationId: triggerAutomationId, idempotencyKey: 'client_created:lease-concurrency-fixture' },
    })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].leaseToken).toBeTruthy()
    expect(runs[0].fencingVersion).toBe(1)
    expect(runs[0].leaseExpiresAt).not.toBeNull()
  })

  it('reclaims an expired generation without re-running completed steps', async () => {
    const schedulerResult = await runDueJobs()
    const recovered = await db.automationRun.findUnique({ where: { id: recoveredRunId } })

    expect(recovered?.status, JSON.stringify({ schedulerResult, recovered })).toBe('success')
    expect(recovered?.fencingVersion).toBe(2)
    expect(recovered?.leaseToken).toBeTruthy()
    expect(recovered?.leaseToken).not.toBe(originalLeaseToken)

    const steps = await db.workflowStepExecution.findMany({ where: { automationRunId: recoveredRunId } })
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe('succeeded')
  })
})
