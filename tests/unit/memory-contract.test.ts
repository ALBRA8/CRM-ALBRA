import { describe, expect, it } from 'vitest'
import { memoryContract, isMemoryType, MEMORY_TYPES } from '@/lib/memory-contract'

/** Contrato universal MemoryDV sobre la memoria EXISTENTE (función pura). */

const base = {
  id: 'm1',
  organizationId: 'org-a',
  clientId: 'client-a1' as string | null,
  key: null as string | null,
  content: 'El cliente prefiere pagos contraentrega',
  source: 'manual' as string,
  type: null as string | null,
  importance: 4,
  createdAt: new Date('2026-01-15T10:00:00Z'),
}

describe('memoryContract (MemoryDV)', () => {
  it('fila manual → fact verificado con scope de cliente', () => {
    const c = memoryContract(base)
    expect(c.agent_id).toBe('crm-albra')
    expect(c.organization_id).toBe('org-a')
    expect(c.domain).toBe('commercial')
    expect(c.type).toBe('fact')
    expect(c.truth_level).toBe('verified')
    expect(c.provenance).toBe('human_input')
    expect(c.scope).toBe('client:client-a1')
    expect(c.confidence).toBe(0.8)
    expect(c.status).toBe('active')
    expect(c.created_at).toBe('2026-01-15T10:00:00.000Z')
  })

  it('source correction → procedural (lección de estilo del vendedor)', () => {
    const c = memoryContract({ ...base, type: null, source: 'correction' })
    expect(c.type).toBe('procedural')
  })

  it('source agent + key → learning inferido; sin clientId → scope organización', () => {
    const c = memoryContract({ ...base, type: null, source: 'agent', key: 'preferencia_pago', clientId: null })
    expect(c.type).toBe('learning')
    expect(c.truth_level).toBe('inferred')
    expect(c.scope).toBe('organization')
    expect(c.evidence).toContain('preferencia_pago')
  })

  it('type explícito gana sobre el mapeo legacy y se valida contra el enum', () => {
    expect(isMemoryType('preference')).toBe(true)
    expect(isMemoryType('trading')).toBe(false)
    const c = memoryContract({ ...base, type: 'observation' })
    expect(c.type).toBe('observation')
    expect(MEMORY_TYPES).toContain('procedural')
  })

  it('importance se acota a 1..5 y nunca produce NaN', () => {
    expect(memoryContract({ ...base, importance: 99 }).confidence).toBe(1)
    expect(memoryContract({ ...base, importance: -3 }).confidence).toBe(0.2)
    expect(memoryContract({ ...base, importance: Number('x') }).confidence).toBe(0.2)
  })
})
