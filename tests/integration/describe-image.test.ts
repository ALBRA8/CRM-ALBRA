import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as describeImagePOST } from '@/app/api/whatsapp/describe-image/route'
import { jsonBody } from '../helpers'

/**
 * POST /api/whatsapp/describe-image — endpoint interno (daemon Baileys → Next).
 * Autenticación por X-Internal-Secret (sin sesión de usuario). Escenarios:
 *  - 401 sin header / con secreto equivocado.
 *  - 400 JSON inválido, sin imageBase64 u orgId.
 *  - 413 imagen demasiado grande.
 *  - 200 happy path (capa de visión mockeada).
 *  - 502 cuando la capa de visión falla (VisionError tipado).
 */

const { describeImage } = vi.hoisted(() => ({ describeImage: vi.fn() }))

vi.mock('@/lib/vision', () => ({
  MAX_IMAGE_BASE64_CHARS: 20 * 1024 * 1024,
  VisionError: class VisionError extends Error {
    status: number
    constructor(message: string, status = 502) {
      super(message)
      this.name = 'VisionError'
      this.status = status
    }
  },
  describeImageBase64: describeImage,
}))

const SECRET = 'internal-test-secret-0123456789abcdef'
const IMG_B64 = Buffer.from('imagen-de-prueba').toString('base64')

function internalReq(body: unknown | string, withSecret = true): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (withSecret) headers.set('x-internal-secret', SECRET)
  return new NextRequest('http://localhost:3000/api/whatsapp/describe-image', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeAll(() => {
  vi.stubEnv('INTERNAL_API_SECRET', SECRET)
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/whatsapp/describe-image', () => {
  it('401 sin header X-Internal-Secret', async () => {
    const res = await describeImagePOST(internalReq({ imageBase64: IMG_B64, orgId: 'org-1' }, false))
    expect(res.status).toBe(401)
    expect(describeImage).not.toHaveBeenCalled()
  })

  it('401 con secreto equivocado', async () => {
    const headers = new Headers({ 'content-type': 'application/json', 'x-internal-secret': 'otro-secreto' })
    const res = await describeImagePOST(
      new NextRequest('http://localhost:3000/api/whatsapp/describe-image', {
        method: 'POST',
        headers,
        body: JSON.stringify({ imageBase64: IMG_B64, orgId: 'org-1' }),
      })
    )
    expect(res.status).toBe(401)
  })

  it('400 con JSON inválido', async () => {
    const res = await describeImagePOST(internalReq('{no-es-json'))
    expect(res.status).toBe(400)
  })

  it('400 sin imageBase64', async () => {
    const res = await describeImagePOST(internalReq({ orgId: 'org-1' }))
    expect(res.status).toBe(400)
    expect((await jsonBody(res)).error).toContain('imageBase64')
  })

  it('400 sin orgId (aislamiento multi-tenant del LLM configurado)', async () => {
    const res = await describeImagePOST(internalReq({ imageBase64: IMG_B64 }))
    expect(res.status).toBe(400)
    expect((await jsonBody(res)).error).toContain('orgId')
  })

  it('413 con imagen que excede el tamaño máximo', async () => {
    const res = await describeImagePOST(internalReq({ imageBase64: 'A'.repeat(40_000_000), orgId: 'org-1' }))
    expect(res.status).toBe(413)
  })

  it('200 happy path con caption → { text }', async () => {
    describeImage.mockResolvedValueOnce('Camisa manga larga azul marino, algodón, nueva, 1 unidad')

    const res = await describeImagePOST(
      internalReq({ imageBase64: IMG_B64, mime: 'image/jpeg', caption: 'busco algo así', orgId: 'org-1' })
    )

    expect(res.status).toBe(200)
    expect(await jsonBody(res)).toEqual({ text: 'Camisa manga larga azul marino, algodón, nueva, 1 unidad' })
    expect(describeImage).toHaveBeenCalledWith('org-1', IMG_B64, {
      mime: 'image/jpeg',
      caption: 'busco algo así',
    })
  })

  it('502 cuando la capa de visión falla', async () => {
    describeImage.mockRejectedValueOnce(new Error('vision down'))
    const res = await describeImagePOST(internalReq({ imageBase64: IMG_B64, orgId: 'org-1' }))
    expect(res.status).toBe(502)
    expect((await jsonBody(res)).error).toContain('No se pudo analizar')
  })
})
