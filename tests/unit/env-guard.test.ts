/**
 * P0.4 — Guardia de secretos de entorno (fail-fast en producción).
 *
 * Verifica que validateEnv/assertEnvForProduction BLOQUEAN el arranque en
 * producción con: valores de ejemplo conocidos (los del antiguo .env.example),
 * marcadores REPLACE_WITH_*, dummies de CI, secretos cortos, de baja entropía
 * y secretos reutilizados. En desarrollo NUNCA bloquea (solo advierte).
 */
import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { KNOWN_INSECURE_VALUES, validateEnv, weakSecretReason } from '@/lib/env-guard'

function strong(): string {
  return randomBytes(48).toString('base64url') // 64 chars, alta entropía
}

const BASE_OK = {
  DATABASE_URL: 'file:./db/custom.db',
  APP_SECRET: '',
  APP_ENCRYPTION_KEY: '',
  INTERNAL_API_SECRET: '',
} as Record<string, string>

function envWith(overrides: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...BASE_OK, ...overrides }
  return env
}

function validateWith(overrides: Record<string, string>) {
  const saved = { ...process.env }
  Object.assign(process.env, envWith(overrides))
  try {
    return validateEnv('production')
  } finally {
    process.env = saved
  }
}

describe('P0.4 — env-guard: producción no arranca con secretos inseguros', () => {
  it('G1: secretos fuertes y distintos → ok', () => {
    const r = validateWith({ APP_SECRET: strong(), APP_ENCRYPTION_KEY: strong(), INTERNAL_API_SECRET: strong() })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('G2: APP_SECRET ausente → error', () => {
    const r = validateWith({ APP_SECRET: '' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.key === 'APP_SECRET' && e.problem.includes('vacío'))).toBe(true)
  })

  it('G3: valores de ejemplo del antiguo .env.example → error (cada uno)', () => {
    for (const v of [
      'cambia-esto-por-un-secreto-largo-y-aleatorio',
      'cambia-esto-por-otra-clave-larga-y-aleatoria',
      'cambia-esto-secreto-interno-daemon',
      'token-de-verificacion-webhook',
    ]) {
      const r = validateWith({ APP_SECRET: v, INTERNAL_API_SECRET: v })
      expect(r.ok, v).toBe(false)
      expect(r.errors.some((e) => e.key === 'APP_SECRET' && e.problem.includes('ejemplo/conocido')), v).toBe(true)
    }
  })

  it('G4: marcadores REPLACE_WITH_* sin reemplazar → error', () => {
    const r = validateWith({ APP_SECRET: 'REPLACE_WITH_STRONG_RANDOM_SECRET', INTERNAL_API_SECRET: strong(), APP_ENCRYPTION_KEY: strong() })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.key === 'APP_SECRET' && e.problem.includes('REPLACE_WITH_'))).toBe(true)
  })

  it('G5: dummies del CI → error si llegan a producción', () => {
    const r = validateWith({ APP_SECRET: 'ci-dummy-secret-test-only-0123456789abcdef', INTERNAL_API_SECRET: strong(), APP_ENCRYPTION_KEY: strong() })
    expect(r.ok).toBe(false)
  })

  it('G6: secreto corto (<32) y de baja entropía → error', () => {
    const corto = validateWith({ APP_SECRET: 'corto-16-chars-ok', INTERNAL_API_SECRET: strong(), APP_ENCRYPTION_KEY: strong() })
    expect(corto.ok).toBe(false)
    expect(corto.errors.some((e) => e.problem.includes('demasiado corto'))).toBe(true)

    const baja = validateWith({ APP_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', INTERNAL_API_SECRET: strong(), APP_ENCRYPTION_KEY: strong() })
    expect(baja.ok).toBe(false)
    expect(baja.errors.some((e) => e.problem.includes('entropía'))).toBe(true)
  })

  it('G7: APP_SECRET idéntico a APP_ENCRYPTION_KEY → error', () => {
    const same = strong()
    const r = validateWith({ APP_SECRET: same, APP_ENCRYPTION_KEY: same, INTERNAL_API_SECRET: strong() })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.problem.includes('idéntico'))).toBe(true)
  })

  it('G8: WHATSAPP_VERIFY_TOKEN débil → error; ausente → solo warning', () => {
    const debil = validateWith({ APP_SECRET: strong(), APP_ENCRYPTION_KEY: strong(), INTERNAL_API_SECRET: strong(), WHATSAPP_VERIFY_TOKEN: 'token-de-verificacion-webhook' })
    expect(debil.ok).toBe(false)
    expect(debil.errors.some((e) => e.key === 'WHATSAPP_VERIFY_TOKEN')).toBe(true)

    const sinToken = validateWith({ APP_SECRET: strong(), APP_ENCRYPTION_KEY: strong(), INTERNAL_API_SECRET: strong(), WHATSAPP_VERIFY_TOKEN: '' })
    expect(sinToken.ok).toBe(true)
    expect(sinToken.warnings.some((w) => w.key === 'WHATSAPP_VERIFY_TOKEN')).toBe(true)
  })

  it('G9: en DESARROLLO los mismos fallos son warnings (no bloquea)', () => {
    const saved = { ...process.env }
    Object.assign(process.env, {
      DATABASE_URL: 'file:./db/custom.db',
      APP_SECRET: 'cambia-esto-por-un-secreto-largo-y-aleatorio',
      APP_ENCRYPTION_KEY: 'cambia-esto-por-otra-clave-larga-y-aleatoria',
      INTERNAL_API_SECRET: 'cambia-esto-secreto-interno-daemon',
    })
    try {
      const r = validateEnv('development')
      expect(r.ok).toBe(true) // no bloquea
      expect(r.errors).toEqual([])
      expect(r.warnings.length).toBeGreaterThanOrEqual(3)
    } finally {
      process.env = saved
    }
  })

  it('G10: tabla KNOWN_INSECURE_VALUES contiene los valores históricos y marcadores', () => {
    for (const v of ['cambia-esto-secreto-interno-daemon', 'replace_with_strong_random_secret', 'ci-dummy-internal-test-only-0123456789abcdef', 'albra-dev-token']) {
      expect(KNOWN_INSECURE_VALUES.has(v)).toBe(true)
    }
    expect(weakSecretReason('REPLACE_WITH_STRONG_RANDOM_SECRET')).toContain('REPLACE_WITH_')
  })
})
