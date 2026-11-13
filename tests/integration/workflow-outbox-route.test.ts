import { afterEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/internal/workflow-outbox/route'

const previousSecret = process.env.WORKFLOW_OUTBOX_WORKER_SECRET
const previousFlag = process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED

afterEach(() => {
  if (previousSecret === undefined) delete process.env.WORKFLOW_OUTBOX_WORKER_SECRET
  else process.env.WORKFLOW_OUTBOX_WORKER_SECRET = previousSecret
  if (previousFlag === undefined) delete process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED
  else process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED = previousFlag
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
})
