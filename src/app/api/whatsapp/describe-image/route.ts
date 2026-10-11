import type { NextRequest } from 'next/server'
import { json } from '@/lib/api-helpers'
import { MAX_IMAGE_BASE64_CHARS, VisionError, describeImageBase64 } from '@/lib/vision'

/**
 * POST /api/whatsapp/describe-image — ENDPOINT INTERNO (daemon Baileys → Next.js).
 *
 * Autenticación: header X-Internal-Secret === INTERNAL_API_SECRET (mismo patrón
 * que /api/whatsapp/transcribe). Sin sesión de usuario: solo procesos internos.
 *
 * Body: { imageBase64: string (base64 crudo), mime?: string, caption?: string, orgId: string }
 * Respuesta: { text } | 400/401/413/502 con { error } descriptivo.
 *
 * La descripción se guarda como WhatsAppMessage messageType='image' y alimenta
 * al agente IA como TEXTO: la imagen se analiza una sola vez (visión) y el
 * resto de la conversación con el LLM del agente es solo texto (tokens mínimos).
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-internal-secret') || ''
  const expected = process.env.INTERNAL_API_SECRET || ''

  if (!expected || !provided || provided !== expected) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { imageBase64?: string; mime?: string; caption?: string; orgId?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, { status: 400 })
  }

  const imageBase64 = (body.imageBase64 || '').replace(/\s/g, '')
  if (!imageBase64) {
    return json({ error: 'imageBase64 es requerido' }, { status: 400 })
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    return json({ error: 'La imagen excede el tamaño máximo permitido (15 MB)' }, { status: 413 })
  }
  const orgId = (body.orgId || '').trim()
  if (!orgId) {
    return json({ error: 'orgId es requerido (aislamiento multi-tenant del LLM configurado)' }, { status: 400 })
  }

  try {
    const text = await describeImageBase64(orgId, imageBase64, {
      mime: body.mime,
      caption: body.caption,
    })
    return json({ text })
  } catch (err) {
    if (err instanceof VisionError) {
      return json({ error: err.message }, { status: err.status })
    }
    console.error('[describe-image] error inesperado', err)
    return json({ error: 'No se pudo analizar la imagen' }, { status: 502 })
  }
}
