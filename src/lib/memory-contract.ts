/**
 * Contrato universal MemoryDV — adaptador de lectura sobre la memoria
 * EXISTENTE del CRM (AgentMemory). NO crea una segunda memoria: normaliza
 * lo que ya hay para que consumidores externos (otros agentes, reportes,
 * exportaciones) reciban la forma canónica:
 *
 *   agent_id · organization_id · domain · type · content · source ·
 *   evidence · provenance · confidence · truth_level · created_at ·
 *   updated_at · last_verified · relevance · utility · decay · scope · status
 *
 * Tipos soportados (columna AgentMemory.type):
 *   fact | preference | observation | learning | procedural
 * Aislamiento: organizationId (+ clientId opcional) — nunca cruza orgs.
 */

export const MEMORY_TYPES = ['fact', 'preference', 'observation', 'learning', 'procedural'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export function isMemoryType(v: unknown): v is MemoryType {
  return typeof v === 'string' && (MEMORY_TYPES as readonly string[]).includes(v)
}

/** Mapeo desde source legado → tipo canónico (cuando la fila no trae type). */
function legacyType(source: string | undefined, key: string | null): MemoryType {
  if (source === 'correction') return 'procedural' // lección de estilo del vendedor
  if (source === 'agent' && key) return 'learning' // hecho consolidado por el agente
  return 'fact'
}

export interface AgentMemoryLike {
  id: string
  organizationId: string
  clientId?: string | null
  key?: string | null
  content: string
  source?: string | null
  type?: string | null
  importance?: number | null
  createdAt: Date | string
}

export interface MemoryDVRecord {
  agent_id: string
  organization_id: string
  domain: string
  type: MemoryType
  content: string
  source: string
  evidence: string[]
  provenance: string
  confidence: number
  truth_level: 'verified' | 'inferred' | 'estimated' | 'unknown'
  created_at: string
  updated_at: string
  last_verified: string
  relevance: number
  utility: number
  decay: number | null
  scope: string
  status: 'active' | 'invalidated'
}

/**
 * Convierte una fila de AgentMemory al contrato MemoryDV. Función PURA y
 * determinística (testeable sin BD): no consulta nada, no muta nada.
 */
export function memoryContract(m: AgentMemoryLike): MemoryDVRecord {
  const type: MemoryType = isMemoryType(m.type) ? m.type : legacyType(m.source ?? undefined, m.key ?? null)
  const importance = Math.min(5, Math.max(1, Number(m.importance ?? 1) || 1))
  const createdAt = new Date(m.createdAt).toISOString()
  const manual = (m.source ?? 'manual') === 'manual'
  return {
    agent_id: 'crm-albra',
    organization_id: m.organizationId,
    domain: 'commercial',
    type,
    content: m.content,
    source: m.source ?? 'manual',
    evidence: m.key ? [m.key] : [],
    provenance: manual ? 'human_input' : 'agent_extraction',
    // confianca degradada por importancia declarada (1..5 → 0.2..1.0)
    confidence: Math.round((importance / 5) * 100) / 100,
    // dato cargado por el humano = verificado; extraído por el agente = inferido
    truth_level: manual ? 'verified' : 'inferred',
    created_at: createdAt,
    updated_at: createdAt,
    last_verified: createdAt,
    relevance: importance,
    utility: importance,
    decay: null, // la memoria comercial no decae por defecto; se invalida, no expira
    scope: m.clientId ? `client:${m.clientId}` : 'organization',
    status: 'active',
  }
}
