import { afterEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/internal/channel-outbox/route'

const originalSecret = process.env.CHANNEL_OUTBOX_WORKER_SECRET
const originalFlag = process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CHANNEL_OUTBOX_WORKER_SECRET
  else process.env.CHANNEL_OUTBOX_WORKER_SECRET = originalSecret
  if (originalFlag === undefined) delete process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED
  else process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED = originalFlag
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
    const response = await GET(request(secret))
    const body = await response.json() as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(body.workerEnabled).toBe(false)
    expect(body).toHaveProperty('outbox')
    expect(body).toHaveProperty('webhookEvents')
    expect(body).toHaveProperty('connectedMetaConnections')
    expect(body).toHaveProperty('sampledAt')
    expect(Object.keys(body).sort()).toEqual(['connectedMetaConnections', 'outbox', 'sampledAt', 'webhookEvents', 'workerEnabled'].sort())
    expect(JSON.stringify(body)).not.toContain(secret)
  })
})
