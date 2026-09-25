import { describe, expect, it, vi } from 'vitest'
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/crypto'

/**
 * Tests unitarios de src/lib/crypto.ts (AES-256-GCM para secretos en reposo).
 * Usa las claves reales del .env cargado por el setup (nunca se imprimen).
 */

describe('encryptSecret / decryptSecret (AES-256-GCM)', () => {
  it('roundtrip: cifra y descifra el valor original', () => {
    const plain = 'EAAx-token-de-Telegram-987654'
    const enc = encryptSecret(plain)
    expect(enc).not.toBeNull()
    expect(enc).toMatch(/^v1:.+:.+:.+$/)
    expect(enc).not.toContain(plain) // el texto plano no aparece en el payload
    expect(decryptSecret(enc)).toBe(plain)
  })

  it('cada cifrado usa un IV aleatorio (dos cifras del mismo texto difieren)', () => {
    const a = encryptSecret('mismo-texto')
    const b = encryptSecret('mismo-texto')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('mismo-texto')
    expect(decryptSecret(b)).toBe('mismo-texto')
  })

  it('valores vacíos/null → null sin lanzar', () => {
    expect(encryptSecret(null)).toBeNull()
    expect(encryptSecret(undefined)).toBeNull()
    expect(encryptSecret('')).toBeNull()
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret(undefined)).toBeNull()
    expect(decryptSecret('')).toBeNull()
  })

  it('valores planos legacy (sin prefijo v1:) pasan a través sin romper', () => {
    expect(decryptSecret('token-plano-antiguo')).toBe('token-plano-antiguo')
  })

  it('detecta manipulación del ciphertext (integridad GCM) → null', () => {
    const enc = encryptSecret('secreto-integro') as string
    const parts = enc.split(':')
    const data = parts[3]
    const flipped = data.slice(0, -1) + (data.endsWith('A') ? 'B' : 'A')
    const tampered = [parts[0], parts[1], parts[2], flipped].join(':')
    expect(decryptSecret(tampered)).toBeNull()
  })

  it('detecta manipulación del auth tag → null', () => {
    const enc = encryptSecret('secreto-integro') as string
    const parts = enc.split(':')
    const tag = parts[2]
    // Se altera el PRIMER carácter: el último puede ser padding base64,
    // cuyos bits sobrantes el decodificador descarta sin cambiar el byte.
    const flippedTag = (tag.startsWith('A') ? 'B' : 'A') + tag.slice(1)
    expect(flippedTag).not.toBe(tag)
    expect(decryptSecret([parts[0], parts[1], flippedTag, parts[3]].join(':'))).toBeNull()
  })

  it('detecta un ciphertext truncado/corrupto → null (sin excepciones)', () => {
    expect(decryptSecret('v1:zzz:yyy:xxx')).toBeNull()
    expect(decryptSecret('v1:solo-tres-partes')).toBeNull()
  })

  it('APP_ENCRYPTION_KEY tiene prioridad sobre APP_SECRET y una clave distinta no descifra', () => {
    // Escenario A: solo existe APP_SECRET → la clave se deriva de él.
    vi.stubEnv('APP_ENCRYPTION_KEY', '')
    const encWithSecretDerived = encryptSecret('cifrado-con-derivada')
    expect(decryptSecret(encWithSecretDerived)).toBe('cifrado-con-derivada')

    // Escenario B: la misma payload descifrada con OTRA clave → GCM falla → null.
    vi.stubEnv('APP_ENCRYPTION_KEY', 'otra-clave-de-cifrado-muy-larga-1234567890')
    expect(decryptSecret(encWithSecretDerived)).toBeNull()
    vi.unstubAllEnvs()
  })

  it('fail-fast: sin APP_ENCRYPTION_KEY ni APP_SECRET → null (nunca clave pública)', () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', '')
    vi.stubEnv('APP_SECRET', '')
    expect(encryptSecret('no-debe-cifrarse')).toBeNull()
    expect(decryptSecret('v1:a:b:c')).toBeNull()
    vi.unstubAllEnvs()
  })
})

describe('maskSecret', () => {
  it('enmascara mostrando solo 3 caracteres iniciales y finales', () => {
    expect(maskSecret('ABCDEF1234WXYZ')).toBe('ABC••••••XYZ')
  })

  it('cadenas cortas o vacías → máscara genérica', () => {
    expect(maskSecret('abc')).toBe('••••••')
    expect(maskSecret('')).toBe('')
    expect(maskSecret(null)).toBe('')
    expect(maskSecret(undefined)).toBe('')
  })
})
