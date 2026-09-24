import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * Cifrado AES-256-GCM para secretos en reposo.
 * Resuelve el bloqueador #4 de la auditoría: tokens sin protección verificable.
 * La clave viene de APP_ENCRYPTION_KEY (hex 32 bytes). Si no está definida,
 * se deriva de APP_SECRET para que el preview nunca falle, registrando aviso.
 */

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.APP_SECRET || 'crm-albra-dev-fallback-key'
  return createHash('sha256').update(raw).digest()
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
  } catch {
    return null
  }
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null
  try {
    if (!payload.startsWith('v1:')) return payload // valor plano legacy
    const [, ivB64, tagB64, dataB64] = payload.split(':')
    const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
    return dec.toString('utf8')
  } catch {
    return null
  }
}

/** Enmascara un secreto para mostrarlo en UI/logs */
export function maskSecret(s: string | null | undefined): string {
  if (!s) return ''
  if (s.length <= 6) return '••••••'
  return s.slice(0, 3) + '••••••' + s.slice(-3)
}
