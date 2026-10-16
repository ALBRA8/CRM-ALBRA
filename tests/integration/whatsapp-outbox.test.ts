import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/whatsapp/outbox/route'

function request(secret?: string) {
  const headers = new Headers()
  if (secret) headers.set('x-internal-secret', secret)
  return new NextRequest('http://localhost:3000/api/whatsapp/outbox', { method: 'POST', headers })
}

describe('POST /api/whatsapp/outbox', () => {
  it('rejects requests without the internal secret', async () => {
    const res = await POST(request())
    expect(res.status).toBe(401)
  })

  it('rejects an incorrect internal secret', async () => {
    const res = await POST(request('not-the-secret'))
    expect(res.status).toBe(401)
  })
})
