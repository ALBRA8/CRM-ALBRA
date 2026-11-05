import { describe, expect, it } from 'vitest'
import { join } from 'path'
import {
  validateOrgId,
  authDirFor,
  connectedSessions,
  decideUnscopedSend,
  planBootRestore,
} from '@/whatsapp-daemon/session-registry.mjs'

/**
 * P0.1 (orden maestra): sesiones de WhatsApp POR ORGANIZACIÓN.
 * Estas pruebas cubren la lógica pura del registro: orgId seguro para rutas,
 * política de envío sin orgId y plan de arranque/migración sin borrado.
 */
describe('session-registry: orgId seguro para rutas de disco', () => {
  it('acepta orgIds válidos (cuid de Prisma)', () => {
    expect(validateOrgId('c1234abcdef')).toBe(true)
    expect(validateOrgId('cmd8xk3f9001abc7defg')).toBe(true)
    expect(validateOrgId('org-demo_1')).toBe(true)
  })

  it('rechaza traversal de ruta y basura (fail-closed)', () => {
    expect(validateOrgId('../etc')).toBe(false)
    expect(validateOrgId('..')).toBe(false)
    expect(validateOrgId('a/b')).toBe(false)
    expect(validateOrgId('a\\b')).toBe(false)
    expect(validateOrgId('.')).toBe(false)
    expect(validateOrgId('')).toBe(false)
    expect(validateOrgId(null)).toBe(false)
    expect(validateOrgId(undefined)).toBe(false)
    expect(validateOrgId(123)).toBe(false)
    expect(validateOrgId('a'.repeat(65))).toBe(false)
  })

  it('authDirFor construye .wa-auth/<orgId> o LANZA con orgId hostil', () => {
    expect(authDirFor('/x/.wa-auth', 'c123')).toBe(join('/x/.wa-auth', 'c123'))
    expect(() => authDirFor('/x/.wa-auth', '../../etc/passwd')).toThrow()
    expect(() => authDirFor('/x/.wa-auth', '')).toThrow()
  })
})

describe('session-registry: política de /send sin orgId', () => {
  it('cero sesiones conectadas → rechazo 400 sin excepción', () => {
    const d = decideUnscopedSend([])
    expect(d.allow).toBe(false)
    expect(d.code).toBe(400)
    expect(d.reason).toMatch(/ninguna sesión/i)
  })

  it('exactamente UNA conectada → se permite y nombra su org', () => {
    const d = decideUnscopedSend([
      { orgId: 'orgA', status: 'connecting' },
      { orgId: 'orgB', status: 'connected' },
    ])
    expect(d.allow).toBe(true)
    expect(d.orgId).toBe('orgB')
  })

  it('dos o más conectadas → 409 exigiendo orgId (aislamiento)', () => {
    const d = decideUnscopedSend([
      { orgId: 'orgA', status: 'connected' },
      { orgId: 'orgB', status: 'connected' },
    ])
    expect(d.allow).toBe(false)
    expect(d.code).toBe(409)
    expect(d.reason).toMatch(/orgId requerido/i)
  })

  it('conectada() ignora entradas malformadas en lugar de confiar en ellas', () => {
    const d = decideUnscopedSend([
      { orgId: '../x', status: 'connected' }, // orgId inválido NO cuenta como conectada
      { orgId: 'orgB', status: 'connected' },
    ])
    expect(d.allow).toBe(true)
    expect(d.orgId).toBe('orgB')
    expect(connectedSessions([{ orgId: 'a', status: 'connected' }, null, {}])).toHaveLength(1)
  })
})

describe('session-registry: plan de arranque y migración legado', () => {
  const ok = () => true
  const no = () => false

  it('sin .wa-auth/ → nada que restaurar', () => {
    const p = planBootRestore({ rootEntries: [], rootIsDir: false, legacyOrgMeta: null, orgExists: ok })
    expect(p.migrate).toBeNull()
    expect(p.restore).toEqual([])
  })

  it('layout por-org con org viva → se restaura esa sesión', () => {
    const p = planBootRestore({ rootEntries: ['c123', 'creds.json.no'], rootIsDir: true, legacyOrgMeta: null, orgExists: ok })
    expect(p.migrate).toBeNull()
    expect(p.restore).toEqual(['c123'])
  })

  it('layout legado plano con org válida → migrar (movimiento) y restaurar', () => {
    const p = planBootRestore({
      rootEntries: ['creds.json', 'session-org.json'],
      rootIsDir: true,
      legacyOrgMeta: { orgId: 'c123', linkedAt: 'x' },
      orgExists: ok,
    })
    expect(p.migrate).toEqual({ from: 'legacy', to: 'c123' })
    expect(p.restore).toContain('c123')
  })

  it('layout legado SIN organización válida → NO se toca NI se conecta (fail-closed)', () => {
    const p = planBootRestore({
      rootEntries: ['creds.json', 'session-org.json'],
      rootIsDir: true,
      legacyOrgMeta: { orgId: 'c123' },
      orgExists: no,
    })
    expect(p.migrate).toBeNull()
    expect(p.restore).toEqual([])
    expect(p.notes.join(' ')).toMatch(/se conserva intacta/i)
  })

  it('carpetas de organizaciones muertas → huérfanas: se conservan, no se conectan', () => {
    const p = planBootRestore({
      rootEntries: ['alive123', 'dead456'],
      rootIsDir: true,
      legacyOrgMeta: null,
      orgExists: (id) => id === 'alive123',
    })
    expect(p.restore).toEqual(['alive123'])
    expect(p.orphaned).toEqual(['dead456'])
    expect(p.notes.join(' ')).toMatch(/se conservan en disco/i)
  })
})
