import { afterEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/internal/channel-outbox/route'

const originalSecret = process.env.CHANNEL_OUTBOX_WORKER_SECRET
const originalFlag = process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED
const originalAutoReplyFlag = process.env.CHANNEL_AUTOREPLY_ENABLED
const originalWorkflowSendFlag = process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
const originalWhatspowerFlag = process.env.WHATSPOWER_ENABLED

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CHANNEL_OUTBOX_WORKER_SECRET
  else process.env.CHANNEL_OUTBOX_WORKER_SECRET = originalSecret
  if (originalFlag === undefined) delete process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED
  else process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED = originalFlag
  if (originalAutoReplyFlag === undefined) delete process.env.CHANNEL_AUTOREPLY_ENABLED
  else process.env.CHANNEL_AUTOREPLY_ENABLED = originalAutoReplyFlag
  if (originalWorkflowSendFlag === undefined) delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
  else process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED = originalWorkflowSendFlag
  if (originalWhatspowerFlag === undefined) delete process.env.WHATSPOWER_ENABLED
  else process.env.WHATSPOWER_ENABLED = originalWhatspowerFlag
})

function request(secret?: string, method = 'GET') {
  return new Request('http://localhost/api/internal/channel-outbox', {
    method,
    headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify({ limit: 1 }) } : {}),
  }) as unknown as NextRequest
}

describe('GET /api/internal/channel-outbox — aggregate health', () => {
  it('requires the dedicated worker secret', async () => {
    process.env.CHANNEL_OUTBOX_WORKER_SECRET = 'x'.repeat(40)
    const response = await GET(request())
    expect(response.status).toBe(401)
  })

  it('refuses to dispatch while the feature flag is disabled', async () => {
    process.env.CHANNEL_OUTBOX_WORKER_SECRET = 'x'.repeat(40)
    process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED = 'false'
    const response = await POST(request('x'.repeat(40), 'POST'))
    expect(response.status).toBe(503)
  })

  it('returns only aggregate counts and reports disabled dispatch without exposing records', async () => {
    const secret = 'x'.repeat(40)
    process.env.CHANNEL_OUTBOX_WORKER_SECRET = secret
    process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED = 'false'
    delete process.env.CHANNEL_AUTOREPLY_ENABLED
    delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
    delete process.env.WHATSPOWER_ENABLED
    const response = await GET(request(secret))
    const body = await response.json() as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(body.workerEnabled).toBe(false)
    expect(body.autoReplyEnabled).toBe(false)
    expect(body.workflowExternalSendsEnabled).toBe(false)
    expect(body.whatspowerBridgeEnabled).toBe(false)
    expect(body).toHaveProperty('outbox')
    expect((body.outbox as Record<string, unknown>).oldestQueuedAgeSeconds).toBeTypeOf('number')
    expect(body).toHaveProperty('webhookEvents')
    expect(body).toHaveProperty('connectedMetaConnections')
    expect(body).toHaveProperty('sampledAt')
    expect(Object.keys(body).sort()).toEqual(['autoReplyEnabled', 'connectedMetaConnections', 'outbox', 'sampledAt', 'webhookEvents', 'workerEnabled', 'workflowExternalSendsEnabled', 'whatspowerBridgeEnabled'].sort())
    expect(JSON.stringify(body)).not.toContain(secret)
  })
})
