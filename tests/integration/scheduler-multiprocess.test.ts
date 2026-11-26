import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { db } from '@/lib/db'
import { FIX } from '../helpers'

const execFileAsync = promisify(execFile)
let automationId: string

beforeAll(async () => {
  const dueAt = new Date(Date.now() - 60_000)
  const automation = await db.automation.create({
    data: {
      organizationId: FIX.orgA.id,
      name: 'Multiprocess scheduler claim',
      triggerType: 'schedule',
      triggerConfig: JSON.stringify({ intervalMinutes: 5 }),
      nextRunAt: dueAt,
      isActive: true,
      actions: '[]',
    },
  })
  automationId = automation.id
})

afterAll(async () => {
  if (automationId) {
    await db.automationRun.deleteMany({ where: { automationId } })
    await db.automation.deleteMany({ where: { id: automationId } })
  }
  await db.$disconnect()
})

describe('scheduler claims across independent Node processes', () => {
  it('creates exactly one durable run when two workers race for the same due automation', async () => {
    // Multiplataforma (Windows incluido): NO usar node_modules/.bin/vitest — en
    // Windows es un shell script que execFile no puede ejecutar (no hay shebang,
    // y el wrapper .cmd/.ps1 no sirve para execFile). Se invoca el punto de
    // entrada real del paquete con el MISMO ejecutable de Node del proceso padre
    // (hallazgo Antigravity 2026-11-26: ENOENT spawn node_modules/.bin/vitest).
    const vitestMjs = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
    const args = [
      'run',
      '--config',
      'vitest.worker.config.mts',
      'tests/fixtures/scheduler-worker.spec.mts',
    ]
    const env = {
      ...process.env,
      SCHEDULER_WORKER_ORG_ID: FIX.orgA.id,
    }

    // Each invocation starts a separate Vitest/Node process with its own
    // scheduler module state and Prisma client, sharing only the test SQLite file.
    const workers = await Promise.all([
      execFileAsync(process.execPath, [vitestMjs, ...args], { cwd: process.cwd(), env, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 }),
      execFileAsync(process.execPath, [vitestMjs, ...args], { cwd: process.cwd(), env, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 }),
    ])

    expect(workers).toHaveLength(2)
    for (const worker of workers) {
      expect(worker.stdout).toContain('1 passed')
    }

    const runs = await db.automationRun.findMany({
      where: { automationId },
    })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')

    const updated = await db.automation.findUnique({ where: { id: automationId } })
    expect(updated?.nextRunAt?.getTime()).toBeGreaterThan(Date.now() - 60_000)
  }, 120_000)
})
