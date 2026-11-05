/**
 * Rate limiter en memoria (ventana fija) para endpoints públicos.
 *
 * Alcance: protección anti-fuerza-bruta / anti-enumeración donde no hay sesión
 * que limitar (p. ej. GET público de /api/nicho). No pretende sustituir un
 * WAF: es la primera línea, sin dependencias externas, segura para un solo
 * proceso Next.js.
 *
 * - Clave sugerida: `ruta:ip` (la IP se resuelve de x-forwarded-for o local).
 * - `resetRateLimits()` existe SOLO para pruebas (vitest lo usa para que cada
 *   test empiece con la ventana limpia); en producción es inocuo.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_TRACKED_KEYS = 10_000 // techo duro de memoria; poda agresiva al superar

export interface RateLimitResult {
  ok: boolean
  /** Segundos hasta que la ventana se reinicie (para Retry-After). */
  retryAfter: number
  /** Peticiones restantes dentro de la ventana actual. */
  remaining: number
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()

  // Poda: si el mapa crece demasiado, expirar lo viejo (evita fuga de memoria
  // bajo ataques de IP spoofing por x-forwarded-for).
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k)
    }
    if (buckets.size > MAX_TRACKED_KEYS) buckets.clear() // último recurso
  }

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0, remaining: limit - 1 }
  }

  bucket.count += 1
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)), remaining: 0 }
  }
  return { ok: true, retryAfter: 0, remaining: limit - bucket.count }
}

/** Solo para pruebas: vacía todas las ventanas. */
export function resetRateLimits(): void {
  buckets.clear()
}

/** IP del cliente para rate limiting (primera entrada de x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64)
  return req.headers.get('x-real-ip')?.slice(0, 64) || 'local'
}
