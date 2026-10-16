/**
 * Capa ASR (voz → texto) del CRM ALBRA. SOLO servidor.
 *
 * Usa el SDK nativo del entorno (z-ai-web-dev-sdk) con import dinámico — igual
 * que src/lib/ai.ts — para que fuera del sandbox la ausencia del SDK no tumbe
 * la app con un 500 críptico: falla tipada (AsrError) con código HTTP apto.
 *
 * Consumidores:
 *  - POST /api/whatsapp/transcribe (endpoint interno para el daemon Baileys)
 *  - Webhook Telegram (notas de voz del Bot API, descarga + transcripción directa)
 *  - Webhook WhatsApp Cloud API (audio de Meta vía Graph API)
 */

export class AsrError extends Error {
  /** Código HTTP sugerido para el endpoint que la propague. */
  status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'AsrError'
    this.status = status
  }
}

/** Límite de audio decodificado aceptado (las notas de voz reales son << 1 MB). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** Longitud máxima permitida para el string base64 (4 chars por cada 3 bytes). */
export const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4

/**
 * Transcribe audio (base64 crudo, sin prefijo data:) y devuelve el texto limpio.
 * Fail-closed: lanza AsrError ante entrada inválida, audio sin voz reconocible
 * o servicio no disponible. Nunca devuelve texto vacío.
 */
export async function transcribeAudioBase64(base64: string, orgId?: string, mime = 'audio/ogg'): Promise<string> {
  const clean = (base64 || '').replace(/\s/g, '')

  if (!clean) {
    throw new AsrError('Audio vacío: falta audioBase64', 400)
  }
  if (clean.length > MAX_AUDIO_BASE64_CHARS) {
    throw new AsrError('El audio excede el tamaño máximo permitido (25 MB)', 413)
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    throw new AsrError('El audio no tiene una codificación base64 válida', 400)
  }

  // Si la organización configuró un proveedor compatible con OpenAI, intenta
  // primero su endpoint ASR. Esto evita depender exclusivamente del SDK del
  // entorno de preview. Proveedores sin ASR compatible degradan al adaptador ZAI.
  if (orgId) {
    try {
      const cfg = await getLLMConfig(orgId)
      if (cfg.apiKey && cfg.baseUrl) {
        const bytes = Buffer.from(clean, 'base64')
        const normalizedMime = mime.split(';')[0].toLowerCase()
        const extensions: Record<string, string> = {
          'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
          'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/webm': 'webm',
          'audio/flac': 'flac',
        }
        const extension = extensions[normalizedMime]
        if (extension) {
          const form = new FormData()
          form.append('file', new Blob([bytes], { type: normalizedMime }), `voice.${extension}`)
          form.append('model', process.env.ASR_MODEL || 'whisper-1')
          const response = await fetch(`${cfg.baseUrl.replace(/\\/$/, '')}/audio/transcriptions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
            body: form,
            signal: AbortSignal.timeout(60_000),
          })
          if (response.ok) {
            const result = await response.json()
            const transcript = typeof result?.text === 'string' ? result.text.trim() : ''
            if (transcript) return transcript
          } else {
            console.warn('[asr] proveedor configurado no ofrece ASR compatible; se probará el adaptador alternativo')
          }
        }
      }
    } catch (err) {
      console.warn('[asr] ASR compatible no disponible; se probará el adaptador alternativo', err instanceof Error ? err.name : 'unknown')
    }
  }

  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const response = await zai.audio.asr.create({ file_base64: clean })
    const text = (response?.text || '').trim()

    if (!text) {
      throw new AsrError(
        'La transcripción llegó vacía (audio sin voz reconocible o formato no soportado)'
      )
    }
    return text
  } catch (err) {
    if (err instanceof AsrError) throw err
    console.error('[asr] error transcribiendo audio', err)
    throw new AsrError('No se pudo transcribir el audio (servicio de voz no disponible)')
  }
}
