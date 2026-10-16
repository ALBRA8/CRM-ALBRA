import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/whatsapp/analyze-image/route'
import { analyzeImageBase64 } from '@/lib/ai'

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return { ...actual, analyzeImageBase64: vi.fn() }
})

function imageRequest(body: unknown, secret?: string, orgId = 'org-a'): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (secret) headers.set('x-internal-secret', secret)
  if (orgId) headers.set('x-whatsapp-org-id', orgId)
  return new NextRequest('http://localhost:3000/api/whatsapp/analyze-image', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/whatsapp/analyze-image', () => {
  it('rechaza solicitudes sin secreto interno', async () => {
    const res = await POST(imageRequest({ imageBase64: 'AA==', mime: 'image/png' }))
    expect(res.status).toBe(401)
    expect(analyzeImageBase64).not.toHaveBeenCalled()
  })

  it('rechaza MIME no permitido antes de llamar al proveedor', async () => {
    const res = await POST(imageRequest(
      { imageBase64: 'AA==', mime: 'text/plain' },
      process.env.INTERNAL_API_SECRET,
    ))
    expect(res.status).toBe(415)
    expect(analyzeImageBase64).not.toHaveBeenCalled()
  })

  it('rechaza bytes cuya firma no corresponde al MIME declarado', async () => {
    const res = await POST(imageRequest(
      { imageBase64: 'AA==', mime: 'image/png' },
      process.env.INTERNAL_API_SECRET,
    ))
    expect(res.status).toBe(415)
    expect(analyzeImageBase64).not.toHaveBeenCalled()
  })

  it('rechaza la ausencia de organización antes de consultar el modelo', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_API_SECRET || '',
    })
    const req = new NextRequest('http://localhost:3000/api/whatsapp/analyze-image', {
      method: 'POST',
      headers,
      body: JSON.stringify({ imageBase64: 'iVBORw0KGgo=', mime: 'image/png' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(analyzeImageBase64).not.toHaveBeenCalled()
  })
})
