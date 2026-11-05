/**
 * P0.4 — Higiene del .env.example (anti-secretos-funcionales).
 *
 * La plantilla NO puede contener secretos funcionales ni valores con forma de
 * credencial: todo valor debe ser o un marcador REPLACE_WITH_* inequívoco o un
 * valor explícitamente NO secreto (URLs locales, puertos, flags, nombres).
 * Así, copiar .env.example → .env y desplegar sin configurar es IMPOSIBLE
 * (env-guard bloquea el arranque; ver tests/unit/env-guard.test.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const EXAMPLE = readFileSync(join(ROOT, '.env.example'), 'utf8')

const SECRET_KEYS = ['APP_SECRET', 'APP_ENCRYPTION_KEY', 'INTERNAL_API_SECRET', 'WHATSAPP_VERIFY_TOKEN']

// Valores legítimamente NO secretos permitidos en la plantilla
const NON_SECRET_ALLOWED = new Set([
  'file:./db/custom.db',
  'smtp.tuproveedor.com',
  '587',
  'CRM ALBRA',
  'http://localhost:3002',
  'http://localhost:9000',
  'true',
  'false',
  '',
])

function parseEnvLines(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    out.push({ key, value })
  }
  return out
}

describe('P0.4 — .env.example sin secretos funcionales', () => {
  it('H1: los secretos core usan el marcador REPLACE_WITH_STRONG_RANDOM_SECRET', () => {
    const vars = parseEnvLines(EXAMPLE)
    for (const key of SECRET_KEYS) {
      const v = vars.find((x) => x.key === key)
      expect(v, `${key} debe existir en la plantilla`).toBeDefined()
      expect(v?.value, `${key} debe ser el marcador explícito`).toBe('REPLACE_WITH_STRONG_RANDOM_SECRET')
    }
  })

  it('H2: ningún valor de la plantilla tiene forma de credencial real', () => {
    const patterns: RegExp[] = [
      /ghp_[A-Za-z0-9]{20,}/,
      /github_pat_[A-Za-z0-9_]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /xox[baprs]-[A-Za-z0-9-]{10,}/,
      /AIza[0-9A-Za-z_-]{35}/,
      /sk-[A-Za-z0-9]{20,}/,
      /albra_[0-9a-f]{16,}/,
      /\b[A-Fa-f0-9]{48,}\b/, // hex largo = token real potencial
      /\b[A-Za-z0-9+/]{40,}={0,2}\b/, // base64 largo = token real potencial
    ]
    for (const { key, value } of parseEnvLines(EXAMPLE)) {
      for (const re of patterns) {
        expect(`${key}=${value}`, `valor con forma de credencial en ${key}`).not.toMatch(re)
      }
    }
  })

  it('H3: todo valor es marcador REPLACE_WITH_*, vacío o NO-secreto conocido', () => {
    for (const { key, value } of parseEnvLines(EXAMPLE)) {
      const ok = value.startsWith('REPLACE_WITH_') || value === '' || NON_SECRET_ALLOWED.has(value)
      expect(ok, `${key}="${value}" no es ni marcador ni valor no-secreto reconocido`).toBe(true)
    }
  })

  it('H4: la plantilla documenta cómo generar secretos y el riesgo de reutilización', () => {
    expect(EXAMPLE).toContain('openssl rand -hex 32')
    expect(EXAMPLE).toContain('DISTINTA') // APP_ENCRYPTION_KEY distinta de APP_SECRET
    expect(EXAMPLE).toContain('RÓTALO y REVÓCALO') // política de rotación
  })
})
