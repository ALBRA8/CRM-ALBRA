import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as transcribePOST } from '@/app/api/whatsapp/transcribe/route'
import { jsonBody } from '../helpers'

/**
 * POST /api/whatsapp/transcribe — endpoint interno (daemon Baileys → Next).
 * Autenticación por X-Internal-Secret (sin sesión de usuario). Escenarios:
 *  - 401 sin header / con secreto equivocado.
 *  - 400 JSON inválido o sin audioBase64.
 *  - 413 audio demasiado grande.
 *  - 200 happy path con el SDK mockeado.
 *  - 502 cuando el servicio ASR falla.
 */

const { asrCreate } = vi.hoisted(() => ({ asrCreate: vi.fn() }))

vi.mock('z-ai-web-dev-sdk', () => ({
  default: {
    create: vi.fn(async () => ({ audio: { asr: { create: asrCreate } } })),
  },
}))

const SECRET = 'internal-test-secret-0123456789abcdef'
const AUDIO_B64 = Buffer.from('audio-falso-de-prueba-ogg').toString('base64')

function internalReq(body: unknown | string, withSecret = true): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (withSecret) headers.set('x-internal-secret', SECRET)
  return new NextRequest('http://localhost:3000/api/whatsapp/transcribe', {
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

describe('POST /api/whatsapp/transcribe', () => {
  it('401 sin header X-Internal-Secret', async () => {
    const res = await transcribePOST(internalReq({ audioBase64: AUDIO_B64 }, false))
    expect(res.status).toBe(401)
    expect(asrCreate).not.toHaveBeenCalled()
  })

  it('401 con secreto equivocado', async () => {
    const headers = new Headers({ 'content-type': 'application/json', 'x-internal-secret': 'otro-secreto' })
    const res = await transcribePOST(
      new NextRequest('http://localhost:3000/api/whatsapp/transcribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({ audioBase64: AUDIO_B64 }),
      })
    )
    expect(res.status).toBe(401)
  })

  it('400 con JSON inválido', async () => {
    const res = await transcribePOST(internalReq('{no-es-json'))
    expect(res.status).toBe(400)
  })

  it('400 sin audioBase64', async () => {
    const res = await transcribePOST(internalReq({ mime: 'audio/ogg' }))
    expect(res.status).toBe(400)
    expect((await jsonBody(res)).error).toContain('audioBase64')
  })

  it('413 con audio que excede el tamaño máximo', async () => {
    const res = await transcribePOST(internalReq({ audioBase64: 'A'.repeat(40_000_000) }))
    expect(res.status).toBe(413)
  })

  it('200 happy path con SDK mockeado → { text }', async () => {
    asrCreate.mockResolvedValueOnce({ text: 'Hola, ¿tienen disponibilidad mañana?' })

    const res = await transcribePOST(internalReq({ audioBase64: AUDIO_B64, mime: 'audio/ogg' }))

    expect(res.status).toBe(200)
    expect(await jsonBody(res)).toEqual({ text: 'Hola, ¿tienen disponibilidad mañana?' })
    expect(asrCreate).toHaveBeenCalledWith({ file_base64: AUDIO_B64 })
  })

  it('502 cuando el servicio ASR falla', async () => {
    asrCreate.mockRejectedValueOnce(new Error('asr down'))

    const res = await transcribePOST(internalReq({ audioBase64: AUDIO_B64 }))

    expect(res.status).toBe(502)
    expect((await jsonBody(res)).error).toContain('No se pudo transcribir')
  })
})
