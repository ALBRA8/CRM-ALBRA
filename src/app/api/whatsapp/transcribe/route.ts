import type { NextRequest } from 'next/server'
import { json } from '@/lib/api-helpers'
import { AsrError, MAX_AUDIO_BASE64_CHARS, transcribeAudioBase64 } from '@/lib/asr'

/**
 * POST /api/whatsapp/transcribe — ENDPOINT INTERNO (daemon Baileys → Next.js).
 *
 * Autenticación: header X-Internal-Secret === INTERNAL_API_SECRET (mismo patrón
 * que usa el daemon contra /api/chat). No hay sesión de usuario: solo procesos
 * internos con el secreto compartido por .env.
 *
 * Body: { audioBase64: string (base64 crudo), mime?: string }
 * Respuesta: { text } | 400/401/413/502 con { error } descriptivo.
 *
 * El daemon descarga la nota de voz (Baileys) y la envía aquí; la transcripción
 * se guarda como WhatsAppMessage messageType='voice' y alimenta al agente IA.
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-internal-secret') || ''
  const expected = process.env.INTERNAL_API_SECRET || ''

  if (!expected || !provided || provided !== expected) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { audioBase64?: string; mime?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, { status: 400 })
  }

  const audioBase64 = (body.audioBase64 || '').replace(/\s/g, '')
  if (!audioBase64) {
    return json({ error: 'audioBase64 es requerido' }, { status: 400 })
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    return json({ error: 'El audio excede el tamaño máximo permitido (25 MB)' }, { status: 413 })
  }

  try {
    const text = await transcribeAudioBase64(audioBase64)
    return json({ text })
  } catch (err) {
    if (err instanceof AsrError) {
      return json({ error: err.message }, { status: err.status })
    }
    console.error('[transcribe] error inesperado', err)
    return json({ error: 'No se pudo transcribir el audio' }, { status: 502 })
  }
}
