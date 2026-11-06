/**
 * session-invalidation.ts — Invalidación de sesiones tras cambio de contraseña
 * (reparación integral 2026-11-06 — orden §6: revocación de sesiones).
 *
 * Mecanismo: cutoff por usuario. Todo JWT lleva `iat`; getAuth() rechaza tokens
 * emitidos ANTES del cutoff registrado. Map en memoria por proceso: el cambio
 * de contraseña invalida sesiones en caliente; en despliegues multi-instancia
 * propagar por pub/sub (documentado en PRODUCTION_READINESS.md).
 */

const cutoffs = new Map<string, number>()

/** Registra el instante de corte: tokens con iat <= cutoff quedan inválidos. */
export function invalidateSessions(userId: string, at: number = Date.now()): void {
  const prev = cutoffs.get(userId)
  if (prev === undefined || at > prev) cutoffs.set(userId, at)
}

/** true si el token (iat en ms) fue emitido antes del último corte. */
export function isSessionInvalidated(userId: string, issuedAtMs: number): boolean {
  const cutoff = cutoffs.get(userId)
  if (cutoff === undefined) return false
  return issuedAtMs <= cutoff
}
