import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/whatsapp/transcribe/route'

function transcribeRequest(opts: { secret?: string; orgId?: string; mime?: string; audioBase64?: string }): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts.secret) headers.set('x-internal-secret', opts.secret)
  if (opts.orgId) headers.set('x-whatsapp-org-id', opts.orgId)
  return new NextRequest('http://localhost:3000/api/whatsapp/transcribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({ audioBase64: opts.audioBase64 ?? 'T2s=', mime: opts.mime ?? 'audio/ogg' }),
  })
}

describe('POST /api/whatsapp/transcribe', () => {
  it('rechaza llamadas sin secreto interno', async () => {
    const res = await POST(transcribeRequest({}))
    expect(res.status).toBe(401)
  })

  it('requiere la organización vinculada del daemon', async () => {
    const res = await POST(transcribeRequest({ secret: process.env.INTERNAL_API_SECRET }))
    expect(res.status).toBe(400)
  })

  it('rechaza MIME que no sea un formato de audio permitido', async () => {
    const res = await POST(transcribeRequest({
      secret: process.env.INTERNAL_API_SECRET,
      orgId: 'org-a',
      mime: 'image/png',
    }))
    expect(res.status).toBe(415)
  })

  it('rechaza audio vacío antes de llamar a ASR', async () => {
    const res = await POST(transcribeRequest({
      secret: process.env.INTERNAL_API_SECRET,
      orgId: 'org-a',
      audioBase64: '',
    }))
    expect(res.status).toBe(400)
  })
})
