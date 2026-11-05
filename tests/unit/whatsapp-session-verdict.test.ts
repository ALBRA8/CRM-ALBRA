import { describe, expect, it } from 'vitest'
import { mapStatusToVerdict } from '@/lib/whatsapp-session-verdict'

/**
 * P0.1: el gate fail-closed del proxy decide con este veredicto quién puede
 * tocar qué sesión. La duda JAMÁS se resuelve a favor del llamador.
 */
describe('veredicto de propiedad contra daemon MULTI-ORG (sessions[])', () => {
  const daemon = (orgIds) => ({
    status: 'connected',
    orgLinked: orgIds.length > 0,
    linkedOrgId: orgIds.length === 1 ? orgIds[0] : null,
    sessions: orgIds.map((orgId) => ({ orgId, status: 'connected', phone: '3000000000' })),
  })

  it('mi organización tiene sesión → SAME_ORG', () => {
    expect(mapStatusToVerdict(daemon(['orgA', 'orgB']), 'orgA')).toBe('SAME_ORG')
    expect(mapStatusToVerdict(daemon(['orgB', 'orgA']), 'orgA')).toBe('SAME_ORG')
  })

  it('mi organización NO tiene sesión → UNLINKED (aunque otras sí)', () => {
    expect(mapStatusToVerdict(daemon(['orgB', 'orgC']), 'orgA')).toBe('UNLINKED')
    expect(mapStatusToVerdict(daemon(['orgB']), 'orgA')).toBe('UNLINKED')
  })

  it('sessions[] vacía o ausente cae al modo legacy (compatibilidad)', () => {
    expect(mapStatusToVerdict({ orgLinked: false, linkedOrgId: null }, 'orgA')).toBe('UNLINKED')
    expect(mapStatusToVerdict({ orgLinked: true, linkedOrgId: 'orgA' }, 'orgA')).toBe('SAME_ORG')
    expect(mapStatusToVerdict({ orgLinked: true, linkedOrgId: 'orgB' }, 'orgA')).toBe('OTHER_ORG')
  })

  it('ambigüedad → UNKNOWN (el proxy deniega; nunca se asume permiso)', () => {
    expect(mapStatusToVerdict(null, 'orgA')).toBe('UNKNOWN')
    expect(mapStatusToVerdict({}, 'orgA')).toBe('UNKNOWN')
    expect(mapStatusToVerdict({ orgLinked: 'sí' }, 'orgA')).toBe('UNKNOWN')
    expect(mapStatusToVerdict({ orgLinked: true, linkedOrgId: 42 }, 'orgA')).toBe('UNKNOWN')
    expect(mapStatusToVerdict({ sessions: [{ status: 'connected' }] }, 'orgA')).toBe('UNKNOWN')
    expect(mapStatusToVerdict({ sessions: 'todo' }, 'orgA')).toBe('UNKNOWN')
  })

  it('una sesión con orgId de MI org pero desconectada sigue siendo SAME_ORG (view/connect OK; operate decidirá el daemon)', () => {
    const j = { orgLinked: true, linkedOrgId: 'orgA', sessions: [{ orgId: 'orgA', status: 'disconnected' }] }
    expect(mapStatusToVerdict(j, 'orgA')).toBe('SAME_ORG')
  })
})
