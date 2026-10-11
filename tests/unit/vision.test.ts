import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { MAX_IMAGE_BASE64_CHARS, VisionError, describeImageBase64 } from '@/lib/vision'

/**
 * Capa de visión (imagen → descripción) — unit.
 * Rutas: 1) LLM externo de la org (fetch mockeado, protocolo OpenAI multimodal),
 * 2) fallback SDK del entorno (createVision mockeado).
 * Escenarios: entrada inválida (400), imagen enorme (413), happy path externo,
 * happy path SDK, externo falla → SDK, ambos fallan → VisionError 502.
 */

const { createVision } = vi.hoisted(() => ({ createVision: vi.fn() }))

vi.mock('@/lib/ai', () => ({
  getLLMConfig: vi.fn(async () => ({ provider: 'zai', baseUrl: null, model: null, apiKey: null })),
}))

vi.mock('z-ai-web-dev-sdk', () => ({
  default: {
    create: vi.fn(async () => ({ chat: { completions: { createVision } } })),
  },
}))

// Imagen base64 pequeña (bytes arbitrarios: la librería no valida contenido)
const IMG_B64 = Buffer.from('imagen-de-prueba').toString('base64')

beforeEach(() => {
  createVision.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('describeImageBase64', () => {
  it('happy path con SDK (sin LLM externo configurado): recorta espacios', async () => {
    createVision.mockResolvedValueOnce({ choices: [{ message: { content: '  Camisa azul marino, algodón  ' } }] })

    const text = await describeImageBase64('org-1', IMG_B64)

    expect(text).toBe('Camisa azul marino, algodón')
    expect(createVision).toHaveBeenCalledTimes(1)
    const body = createVision.mock.calls[0][0]
    expect(body.messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image_url' }),
        expect.objectContaining({ type: 'text' }),
      ])
    )
    // Sin org-LLM, el fetch externo jamás se llama
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('usa el LLM externo de la org cuando está configurado (protocolo OpenAI)', async () => {
    const { getLLMConfig } = await import('@/lib/ai')
    ;(getLLMConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      provider: 'groq',
      baseUrl: 'https://api.groq.com/v1',
      model: 'meta-llama/llama-4-scout',
      apiKey: 'gsk_test',
    })
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Tenis deportivos blancos, talla 42' } }] }),
    })

    const text = await describeImageBase64('org-1', IMG_B64, { mime: 'image/png', caption: '¿tienen similares?' })

    expect(text).toBe('Tenis deportivos blancos, talla 42')
    expect(createVision).not.toHaveBeenCalled()
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.groq.com/v1/chat/completions')
    const payload = JSON.parse(init.body)
    expect(payload.model).toBe('meta-llama/llama-4-scout')
    expect(payload.max_tokens).toBe(300) // techo de salida: descripciones baratas
    expect(payload.messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image_url', image_url: { url: expect.stringContaining('data:image/png;base64,') } }),
      ])
    )
    // El caption viaja en la parte de texto
    expect(payload.messages[0].content[0].text).toContain('¿tienen similares?')
  })

  it('LLM externo falla (modelo sin visión) → fallback al SDK', async () => {
    const { getLLMConfig } = await import('@/lib/ai')
    ;(getLLMConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      provider: 'custom',
      baseUrl: 'https://mi-llm.example/v1',
      model: 'texto-only',
      apiKey: 'k',
    })
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'model does not support images',
    })
    createVision.mockResolvedValueOnce({ choices: [{ message: { content: 'Descripción por SDK' } }] })

    await expect(describeImageBase64('org-1', IMG_B64)).resolves.toBe('Descripción por SDK')
    expect(createVision).toHaveBeenCalledTimes(1)
  })

  it('sin orgId → VisionError 400 sin llamar a nada', async () => {
    await expect(describeImageBase64('', IMG_B64)).rejects.toMatchObject({
      name: 'VisionError',
      status: 400,
    })
    expect(createVision).not.toHaveBeenCalled()
  })

  it('base64 vacío → VisionError 400', async () => {
    await expect(describeImageBase64('org-1', '')).rejects.toMatchObject({ status: 400 })
    await expect(describeImageBase64('org-1', '   \n ')).rejects.toBeInstanceOf(VisionError)
  })

  it('imagen demasiado grande → VisionError 413 sin llamar a nada', async () => {
    const huge = 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 1)
    await expect(describeImageBase64('org-1', huge)).rejects.toMatchObject({ status: 413 })
    expect(createVision).not.toHaveBeenCalled()
  })

  it('descripción vacía del SDK → VisionError 502 fail-closed', async () => {
    createVision.mockResolvedValueOnce({ choices: [{ message: { content: '   ' } }] })
    await expect(describeImageBase64('org-1', IMG_B64)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('vacía'),
    })
  })

  it('SDK caído y sin LLM externo → VisionError 502 con mensaje claro', async () => {
    createVision.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(describeImageBase64('org-1', IMG_B64)).rejects.toMatchObject({
      name: 'VisionError',
      status: 502,
      message: expect.stringContaining('No se pudo analizar'),
    })
  })
})
