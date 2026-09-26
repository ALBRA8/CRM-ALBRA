import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AsrError, MAX_AUDIO_BASE64_CHARS, transcribeAudioBase64 } from '@/lib/asr'

/**
 * Capa ASR (voz → texto) — unit con el SDK z-ai-web-dev-sdk mockeado.
 * Escenarios: happy path (trim), entrada inválida (400), audio demasiado
 * grande (413), transcripción vacía (502) y servicio caído (502).
 */

const { asrCreate } = vi.hoisted(() => ({ asrCreate: vi.fn() }))

vi.mock('z-ai-web-dev-sdk', () => ({
  default: {
    create: vi.fn(async () => ({ audio: { asr: { create: asrCreate } } })),
  },
}))

const AUDIO_B64 = Buffer.from('audio-falso-ogg').toString('base64')

beforeEach(() => {
  asrCreate.mockReset()
})

describe('transcribeAudioBase64', () => {
  it('happy path: transcribe, recorta espacios y pasa el base64 limpio al SDK', async () => {
    asrCreate.mockResolvedValueOnce({ text: '  Hola, quiero agendar una cita  ' })

    const text = await transcribeAudioBase64(` ${AUDIO_B64}\n`)

    expect(text).toBe('Hola, quiero agendar una cita')
    expect(asrCreate).toHaveBeenCalledTimes(1)
    expect(asrCreate).toHaveBeenCalledWith({ file_base64: AUDIO_B64 })
  })

  it('base64 vacío o solo espacios → AsrError 400 sin llamar al SDK', async () => {
    await expect(transcribeAudioBase64('')).rejects.toMatchObject({
      name: 'AsrError',
      status: 400,
    })
    await expect(transcribeAudioBase64('   \n  ')).rejects.toBeInstanceOf(AsrError)
    expect(asrCreate).not.toHaveBeenCalled()
  })

  it('audio demasiado grande → AsrError 413 sin llamar al SDK', async () => {
    const huge = 'A'.repeat(MAX_AUDIO_BASE64_CHARS + 1)

    await expect(transcribeAudioBase64(huge)).rejects.toMatchObject({ status: 413 })
    expect(asrCreate).not.toHaveBeenCalled()
  })

  it('transcripción vacía (audio sin voz reconocible) → AsrError 502', async () => {
    asrCreate.mockResolvedValueOnce({ text: '   ' })

    await expect(transcribeAudioBase64(AUDIO_B64)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('vacía'),
    })
  })

  it('SDK caído / no disponible → AsrError 502 con mensaje claro', async () => {
    asrCreate.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(transcribeAudioBase64(AUDIO_B64)).rejects.toMatchObject({
      name: 'AsrError',
      status: 502,
      message: expect.stringContaining('No se pudo transcribir'),
    })
  })
})
