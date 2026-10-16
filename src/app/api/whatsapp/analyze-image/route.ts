import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { json } from '@/lib/api-helpers'
import { analyzeImageBase64 } from '@/lib/ai'
import sharp from 'sharp'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function hasExpectedSignature(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
  if (mime === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}

/**
 * POST /api/whatsapp/analyze-image — endpoint interno para el daemon Baileys.
 * Nunca acepta URLs remotas; solo imágenes descargadas por el daemon, acotadas
 * en tamaño y verificadas por firma binaria antes de enviarlas al modelo de visión.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_API_SECRET || ''
  const provided = req.headers.get('x-internal-secret') || ''
  if (!secretMatches(provided, expected)) return json({ error: 'Unauthorized' }, { status: 401 })

  const length = Number(req.headers.get('content-length') || 0)
  if (length > 12 * 1024 * 1024) return json({ error: 'La solicitud excede el tamaño permitido' }, { status: 413 })

  let body: { imageBase64?: unknown; mime?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, { status: 400 })
  }

  const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : ''
  const encoded = typeof body.imageBase64 === 'string' ? body.imageBase64.replace(/\s/g, '') : ''
  if (!MIME_TYPES.has(mime)) return json({ error: 'Formato de imagen no soportado' }, { status: 415 })
  if (!encoded || encoded.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    return json({ error: 'Imagen base64 inválida o superior a 8 MiB' }, { status: encoded.length > MAX_BASE64_CHARS ? 413 : 400 })
  }

  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== encoded) {
    return json({ error: 'Codificación de imagen inválida o tamaño excedido' }, { status: 400 })
  }
  // Validar el tenant antes de gastar CPU o invocar el proveedor.
  const orgId = req.headers.get('x-whatsapp-org-id') || ''
  if (!orgId || orgId.length > 128) return json({ error: 'Organización de WhatsApp requerida' }, { status: 400 })
  if (!hasExpectedSignature(bytes, mime)) return json({ error: 'El contenido binario no coincide con el formato declarado' }, { status: 415 })
  try {
    const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()
    const expectedFormat: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
    if (metadata.format !== expectedFormat[mime] || !metadata.width || !metadata.height) {
      return json({ error: 'Imagen corrupta o formato interno no válido' }, { status: 415 })
    }
  } catch {
    return json({ error: 'Imagen corrupta o demasiado compleja para procesar' }, { status: 415 })
  }

  try {
    const text = await analyzeImageBase64(orgId, encoded, mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif')
    return json({ text })
  } catch (err) {
    console.error('[whatsapp analyze-image] vision provider failed', err instanceof Error ? err.message : 'unknown error')
    return json({ error: 'No se pudo analizar la imagen con el proveedor de visión configurado' }, { status: 502 })
  }
}
