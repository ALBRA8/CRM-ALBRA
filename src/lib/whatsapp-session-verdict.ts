/**
 * Veredicto de propiedad de sesión WhatsApp por organización (P0.1).
 *
 * Módulo puro (sin fetch, sin Next): traduce la respuesta de GET /status del
 * daemon multi-organización al veredicto que el proxy usa para su gate
 * fail-closed. Lo ejercitan los tests unitarios.
 *
 * Contrato del daemon multi-org (/status):
 *   { status, phone, orgLinked, linkedOrgId, lastError,
 *     sessions: [{ orgId, status, phone, lastUpdate, lastError }] }
 *
 * Reglas (la duda NUNCA se resuelve a favor del llamador):
 *   - sesión de sessions[] con orgId === authOrgId   → SAME_ORG
 *   - sessions[] válida y mi org no está en ella     → UNLINKED
 *   - daemon legacy (sin sessions[])                  → lógica antigua con
 *     orgLinked/linkedOrgId (compatibilidad durante despliegues mixtos)
 *   - respuesta ambigua / campos con tipo inesperado  → UNKNOWN (→ 403)
 */

export type OwnershipVerdict = 'SAME_ORG' | 'UNLINKED' | 'OTHER_ORG' | 'UNKNOWN'

export interface DaemonStatusPayload {
  orgLinked?: unknown
  linkedOrgId?: unknown
  sessions?: unknown
}

export interface DaemonSessionEntry {
  orgId: unknown
  status?: unknown
  phone?: unknown
  lastUpdate?: unknown
  lastError?: unknown
}

/** sessions[] bien formada: array no vacío de objetos con orgId string no vacío. */
function parseSessions(j: DaemonStatusPayload): DaemonSessionEntry[] | null {
  if (!Array.isArray(j.sessions) || j.sessions.length === 0) return null
  const ok = j.sessions.every(
    (s) => typeof s === 'object' && s !== null && typeof (s as DaemonSessionEntry).orgId === 'string' && ((s as DaemonSessionEntry).orgId as string).length > 0
  )
  return ok ? (j.sessions as DaemonSessionEntry[]) : null
}

export function mapStatusToVerdict(j: DaemonStatusPayload | null | undefined, authOrgId: string): OwnershipVerdict {
  if (!j || typeof j !== 'object') return 'UNKNOWN'

  const sessions = parseSessions(j)
  if (sessions) {
    // Daemon multi-organización: la pregunta es si MI organización tiene sesión.
    const mine = sessions.find((s) => s.orgId === authOrgId)
    return mine ? 'SAME_ORG' : 'UNLINKED'
  }

  // Fallback legacy: daemon de UNA sesión (o respuesta sin sessions[]).
  if (typeof j.orgLinked !== 'boolean') return 'UNKNOWN' // ambigua → DENIED
  if (!j.orgLinked) return 'UNLINKED' // daemon VERIFICÓ explícitamente: no hay sesión
  if (typeof j.linkedOrgId !== 'string' || !j.linkedOrgId) return 'UNKNOWN'
  return j.linkedOrgId === authOrgId ? 'SAME_ORG' : 'OTHER_ORG'
}
