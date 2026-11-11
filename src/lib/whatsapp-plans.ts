/**
 * whatsapp-plans.ts — Límites de conexiones WhatsApp por plan (OLEADA 2).
 *
 * Decisión de negocio 2026-11-11 (punto 1): "Cada organización podrá conectar
 * uno o varios números de WhatsApp, según su plan."
 *
 * La autoridad del límite vive EN EL SERVIDOR (la UI puede ocultar el botón,
 * pero aquí se decide de verdad — mismo principio de rbac.ts). El conteo es
 * siempre por organizationId y por conexiones ACTIVAS (connected/pending):
 * desconectar un número libera su cupo.
 */

export interface PlanConnectionLimits {
  /** Número máximo de conexiones WhatsApp simultáneas de la organización. */
  maxConnections: number
  /** Etiqueta legible para mensajes de error y UI. */
  label: string
}

/** Planes actuales de ALBRA SaaS. `pilot` es el plan inicial sin coste. */
export const PLAN_CONNECTION_LIMITS: Record<string, PlanConnectionLimits> = {
  pilot: { maxConnections: 1, label: 'Pilot (1 número)' },
  starter: { maxConnections: 2, label: 'Starter (hasta 2 números)' },
  growth: { maxConnections: 5, label: 'Growth (hasta 5 números)' },
  enterprise: { maxConnections: 20, label: 'Enterprise (hasta 20 números)' },
}

/** Límite por defecto para planes desconocidos: fail-closed al mínimo (1). */
export function planLimitFor(plan: string | null | undefined): PlanConnectionLimits {
  if (!plan) return PLAN_CONNECTION_LIMITS.pilot
  return PLAN_CONNECTION_LIMITS[plan] ?? PLAN_CONNECTION_LIMITS.pilot
}

/**
 * Verifica si la organización puede registrar UNA conexión más.
 * `activeCount` = conexiones en estado connected o pending (ocupan cupo;
 * disconnected/revoked/error liberan cupo y quedan como histórico auditable).
 */
export function canAddConnection(
  plan: string | null | undefined,
  activeCount: number,
): { allowed: boolean; limit: number; planLabel: string } {
  const { maxConnections, label } = planLimitFor(plan)
  return { allowed: activeCount < maxConnections, limit: maxConnections, planLabel: label }
}
