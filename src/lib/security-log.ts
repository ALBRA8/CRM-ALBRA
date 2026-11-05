/**
 * Registro de eventos de seguridad (P0.3).
 *
 * Los eventos sospechosos (manipulación de parámetros, enumeración de slugs,
 * rate limiting alcanzado) se escriben en:
 *  1. stderr estructurado (`security_event` JSON) — recolectable por cualquier
 *     agregador de logs sin dependencias.
 *  2. Un ring buffer en memoria (últimos 500) consultable por diagnóstico.
 *
 * NO se escribe en ActivityLog: esos eventos suelen ocurrir ANONIMAMENTE (sin
 * organización válida a la que atribuirlos) y la tabla exige organizationId;
 * inventar una org para poder auditar sería peor que el remedio.
 * Los eventos AUTENTICados relevantes siguen auditándose con auditAndTimeline.
 */

export interface SecurityEvent {
  type: string
  at: string
  [key: string]: unknown
}

const RING_SIZE = 500
const ring: SecurityEvent[] = []

export function logSecurityEvent(type: string, meta: Record<string, unknown> = {}): void {
  const event: SecurityEvent = { type, at: new Date().toISOString(), ...meta }
  // Nunca imprimir valores que puedan parecer secretos: los metadatos se
  // truncan para no convertir el log en un canal de fuga.
  const safe = JSON.stringify(event, (_k, v) => (typeof v === 'string' ? v.slice(0, 120) : v))
  console.warn(`[security] ${safe}`)
  ring.push(event)
  if (ring.length > RING_SIZE) ring.shift()
}

/** Eventos recientes (diagnóstico/pruebas). NO expuesto por API pública. */
export function recentSecurityEvents(n = 50): SecurityEvent[] {
  return ring.slice(-n)
}
