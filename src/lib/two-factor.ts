import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * two-factor.ts — Autenticación de dos factores TOTP (RFC 6238 / RFC 4226)
 * OLEADA 2 — decisión de negocio 2026-11-11: multiusuario real con 2FA.
 *
 * Implementación SIN dependencias externas (HMAC-SHA1, 6 dígitos, periodo 30 s,
 * ventana de tolerancia ±1 — estándar de Google Authenticator/Authy/1Password):
 *
 *  - base32Encode/base32Decode: RFC 4648 (alfabeto A-Z2-7) para los secretos.
 *  - totpCode: HOTP dinámico con truncado RFC 4226 (bit de signo enmascarado).
 *  - verifyTotp: ventana ±1, comparación timing-safe y anti-replay por contador.
 *  - Secreto en BD SIEMPRE cifrado (AES-256-GCM, src/lib/crypto.ts): esta lib
 *    solo lo produce y lo verifica; el cifrado en reposo vive en el llamador.
 *  - Códigos de recuperación: 8 códigos de un solo uso; en BD SOLO su hash
 *    SHA-256 (el código en claro se muestra UNA vez, igual que las API keys).
 *
 * SEGURIDAD: nada del secreto o códigos se loguea. Los errores son genéricos.
 */

// ---------- Base32 (RFC 4648) ----------

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('base32 inválido')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ---------- TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) ----------

export const TOTP_PERIOD_SEC = 30
export const TOTP_DIGITS = 6

/** Contador T (tiempo / periodo) en el instante dado. */
export function totpCounterAt(date: Date, periodSec = TOTP_PERIOD_SEC): number {
  return Math.floor(Math.floor(date.getTime() / 1000) / periodSec)
}

/** Código TOTP para el secreto y contador dados (truncado RFC 4226). */
export function totpCode(secretBase32: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secretBase32)
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  msg.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac('sha1', key).update(msg).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/** Comparación timing-safe de dos códigos de la misma longitud. */
function codesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export interface TotpVerifyResult {
  ok: boolean
  /** Contador que correspondió (para guardar el anti-replay). */
  counter?: number
  /** true si el código era correcto PERO ya fue consumido (replay). */
  replayed?: boolean
}

/**
 * Verifica un código TOTP con ventana ±1 paso (90 s de tolerancia de reloj).
 * `notBeforeCounter`: anti-replay — si se entrega, solo acepta contadores
 * ESTRICTAMENTE mayores (el código del último login no vuelve a servir).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { window?: number; notBeforeCounter?: number; now?: Date } = {}
): TotpVerifyResult {
  const clean = (code || '').replace(/\D/g, '')
  if (clean.length !== TOTP_DIGITS) return { ok: false }
  const window = opts.window ?? 1
  const now = totpCounterAt(opts.now ?? new Date())
  let replayHit = false
  for (let i = -window; i <= window; i++) {
    const counter = now + i
    const expected = totpCode(secretBase32, counter)
    if (!codesEqual(expected, clean)) continue
    if (opts.notBeforeCounter !== undefined && counter <= opts.notBeforeCounter) {
      replayHit = true
      continue
    }
    return { ok: true, counter }
  }
  return { ok: false, replayed: replayHit }
}

// ---------- Enrolamiento ----------

/** Secreto nuevo: 20 bytes aleatorios → base32 (longitud estándar de 160 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** URI de aprovisionamiento estándar (Google Authenticator compatible). */
export function provisioningUri(email: string, secretBase32: string): string {
  const label = encodeURIComponent(`ALBRA:${email}`)
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: 'ALBRA',
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ---------- Códigos de recuperación (un solo uso) ----------

// Sin caracteres ambiguos (I, L, O, U, 0, 1): se leen/dictan sin errores.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
export const RECOVERY_CODES_COUNT = 8

export function generateRecoveryCodes(n = RECOVERY_CODES_COUNT): string[] {
  const codes: string[] = []
  for (let i = 0; i < n; i++) {
    const bytes = randomBytes(8)
    let raw = ''
    for (const b of bytes) raw += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`)
  }
  return codes
}

/** Normaliza un código de recuperación (mayúsculas, sin separadores). */
export function normalizeRecoveryCode(code: string): string {
  return (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** En BD solo vive el hash del código NORMALIZADO (acepta crudo o normalizado). */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex')
}

/**
 * Consume un código de recuperación contra la lista almacenada (JSON de hashes).
 * Devuelve la lista ACTUALIZADA (sin el código usado) o null si no coincide.
 * El llamador debe persistir la lista devuelta (un solo uso real).
 */
export function consumeRecoveryCode(
  storedJson: string | null | undefined,
  code: string
): { remaining: string[] } | null {
  let stored: string[] = []
  try {
    const parsed = JSON.parse(storedJson || '[]')
    if (Array.isArray(parsed)) stored = parsed.filter((x) => typeof x === 'string')
  } catch {
    return null
  }
  const hash = hashRecoveryCode(normalizeRecoveryCode(code))
  if (!stored.includes(hash)) return null
  return { remaining: stored.filter((h) => h !== hash) }
}
