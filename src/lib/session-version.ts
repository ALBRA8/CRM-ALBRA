/**
 * Revocación de sesiones por `tokenVersion` (reparación integral B4).
 *
 * Contrato: cada User lleva un contador `tokenVersion`. Los JWT se firman con
 * la versión del usuario en el momento del login y las guardas (getAuth)
 * RECHAZAN el token si la versión vigente del usuario es mayor — así, logout,
 * reset de contraseña y desactivación invalidan al instante los JWT ya emitidos
 * (7 días de vida) sin lista de bloqueo externa.
 *
 * Restricción estructural del repo: getAuth/requireAuth son SÍNCRONOS y 89
 * archivos los consumen (incluidos módulos de terceros que no se pueden tocar),
 * de modo que la consulta de BD no puede vivir dentro de la guarda. Se resuelve
 * con un caché en proceso:
 *
 *  - `prewarmSessionVersions()` (instrumentation.register, arranque del server)
 *    carga las versiones de TODOS los usuarios → el caché parte exacto.
 *  - Los puntos que REVOCAN (logout, reset, desactivación) actualizan el caché
 *    de forma SÍNCRONA en el mismo proceso → el rechazo es inmediato y exacto.
 *  - `scheduleRefreshSessionVersion()` refresca el valor desde BD (fire-and-forget,
 *    con debounce) en cada petición autenticada → convergencia si hubiera más
 *    de un proceso (despliegue actual: un solo proceso Next + SQLite).
 *
 * Semántica honesta del caché: si un userId NO está en el caché (ventana entre
 * el arranque del proceso y el prewarm) la sesión NO se considera revocada
 * (fail-open acotado); el prewarm y el refresh la cierran. Los eventos de
 * revocación del propio proceso son siempre exactos.
 */

const cache = new Map<string, number>()
const lastRefreshAt = new Map<string, number>()
const REFRESH_DEBOUNCE_MS = 30_000

/** Versión vigente en caché (null = desconocida: no se puede afirmar revocación). */
export function getSessionVersion(userId: string): number | null {
  return cache.get(userId) ?? null
}

/** Fija la versión vigente (usado por prewarm y por las rutas que revocan). */
export function setSessionVersion(userId: string, version: number): void {
  cache.set(userId, version)
}

/**
 * Registra la versión NUEVA tras un incremento persistido en BD. Debe llamarse
 * inmediatamente después del `db.user.update({ tokenVersion: { increment: 1 } })`
 * para que el rechazo sea inmediato en este proceso.
 */
export function bumpTokenVersionForUser(userId: string, newVersion: number): void {
  const current = cache.get(userId) ?? 0
  cache.set(userId, Math.max(current, newVersion))
}

/**
 * ¿Está revocado un token firmado con `tokenVersion`?
 * - Token sin claim (previo a B4) → se trata como versión 0.
 * - Caché desconocida (null) → no se puede afirmar revocación (false).
 * - Caché mayor que la del token → revocado.
 */
export function isSessionRevoked(userId: string, tokenVersion: number | undefined): boolean {
  const current = cache.get(userId)
  if (current === undefined) return false
  return current > (tokenVersion ?? 0)
}

/**
 * Refresco perezoso desde BD (fire-and-forget, con debounce por usuario).
 * Converge el caché cuando la revocación ocurrió en OTRO proceso.
 */
export function scheduleRefreshSessionVersion(userId: string): void {
  const now = Date.now()
  const last = lastRefreshAt.get(userId) ?? 0
  if (now - last < REFRESH_DEBOUNCE_MS) return
  lastRefreshAt.set(userId, now)
  void (async () => {
    try {
      const { db } = await import('./db')
      const user = await db.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } })
      if (user) cache.set(userId, user.tokenVersion)
    } catch {
      // best-effort: el caché mantiene el último valor conocido
    }
  })()
}

/**
 * Prewarm al arranque del servidor (instrumentation.register): carga las
 * versiones de todos los usuarios. Devuelve cuántos usuarios cargó.
 */
export async function prewarmSessionVersions(): Promise<number> {
  const { db } = await import('./db')
  const users = await db.user.findMany({ select: { id: true, tokenVersion: true } })
  for (const u of users) cache.set(u.id, u.tokenVersion)
  return users.length
}

/** Solo pruebas: vacía el caché. */
export function resetSessionVersionCache(): void {
  cache.clear()
  lastRefreshAt.clear()
}
