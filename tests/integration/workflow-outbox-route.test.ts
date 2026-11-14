import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { FIX } from '../setup/seed-data'

const { dispatchMock, quarantineMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  quarantineMock: vi.fn(),
}))

vi.mock('@/lib/workflow-outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflow-outbox')>()
  return {
    ...actual,
    dispatchWorkflowOutboundMessage: dispatchMock,
    quarantineStaleWorkflowOutboundMessages: quarantineMock,
  }
})

import { GET, POST } from '@/app/api/internal/workflow-outbox/route'

const previousSecret = process.env.WORKFLOW_OUTBOX_WORKER_SECRET
const previousFlag = process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED
const queuePrefix = 'route-starvation-test:'
const createdIds: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  if (previousSecret === undefined) delete process.env.WORKFLOW_OUTBOX_WORKER_SECRET
  else process.env.WORKFLOW_OUTBOX_WORKER_SECRET = previousSecret
  if (previousFlag === undefined) delete process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED
  else process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED = previousFlag
  if (createdIds.length) {
    await db.workflowOutboundMessage.deleteMany({ where: { id: { in: createdIds } } })
    createdIds.length = 0
  }
})

function request(secret?: string, method = 'GET') {
  return new Request('http://localhost/api/internal/workflow-outbox', {
    method,
    headers: {
      ...(secret ? { Authorization: 'Bearer ' + secret } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify({ limit: 1 }) } : {}),
  }) as unknown as NextRequest
}

describe('internal workflow outbox worker', () => {
  it('rejects requests without the dedicated worker secret', async () => {
    process.env.WORKFLOW_OUTBOX_WORKER_SECRET = 'x'.repeat(40)
    expect((await GET(request())).status).toBe(401)
  })

  it('refuses dispatch while the independent feature gate is disabled', async () => {
    const secret = 'x'.repeat(40)
    process.env.WORKFLOW_OUTBOX_WORKER_SECRET = secret
    process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED = 'false'
    expect((await POST(request(secret, 'POST'))).status).toBe(503)
  })

  it('returns aggregate health only and does not expose queue records', async () => {
    const secret = 'x'.repeat(40)
    process.env.WORKFLOW_OUTBOX_WORKER_SECRET = secret
    process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED = 'false'
    const response = await GET(request(secret))
    const body = await response.json() as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(body.workerEnabled).toBe(false)
    expect(body).toHaveProperty('outbox')
    expect(Object.keys(body).sort()).toEqual(['outbox', 'sampledAt', 'workerEnabled'].sort())
    expect(JSON.stringify(body)).not.toContain(secret)
  })

  it('skips a full page of disabled intents and still dispatches the next eligible item', async () => {
    const secret = 'x'.repeat(40)
    process.env.WORKFLOW_OUTBOX_WORKER_SECRET = secret
    process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED = 'true'
    quarantineMock.mockResolvedValue({ count: 0 })

    const now = Date.now()
    const rows = await Promise.all(Array.from({ length: 51 }, (_, index) =>
      db.workflowOutboundMessage.create({
        data: {
          organizationId: FIX.orgA.id,
          automationId: null,
          automationRunId: null,
          stepIndex: 0,
          idempotencyKey: queuePrefix + index,
          channel: index === 50 ? 'whatsapp' : 'telegram',
          payloadEnc: 'test-ciphertext',
          createdAt: new Date(now + index),
        },
        select: { id: true, channel: true },
      }),
    ))
    createdIds.push(...rows.map(row => row.id))
    const eligibleId = rows[50].id
    dispatchMock.mockImplementation(async (id: string) =>
      id === eligibleId ? { status: 'sent' } : { status: 'disabled' },
    )

    const response = await POST(request(secret, 'POST'))
    const body = await response.json() as { processed: number; scanned: number; results: Array<{ status: string }> }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ processed: 1, scanned: 51, results: [{ status: 'sent' }] })
    expect(dispatchMock).toHaveBeenCalledTimes(51)
    expect(await db.workflowOutboundMessage.count({
      where: { id: { in: createdIds }, status: 'queued' },
    })).toBe(51)
  })
})
