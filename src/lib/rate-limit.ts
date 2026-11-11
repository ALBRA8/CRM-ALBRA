/**
 * Rate limiting (segunda reparación integral 2026-11-06 — orden §2.C).
 *
 * Dos capas:
 *
 * 1) `rateLimit()` — memoria de proceso, ventana fija. Para endpoints de
 *    lectura de alta frecuencia donde el costo de una escritura en BD por
 *    petición no está justificado y la exactitud multi-instancia no es
 *    crítica (p. ej. GET público de /api/nicho). Documentado como best-effort
 *    de un solo proceso: NO es la defensa de los endpoints sensibles.
 *
 * 2) `dbRateLimit()` — contadores PERSISTENTES en BD (tabla RateLimitBucket).
 *    Es la capa OBLIGATORIA para login / forgot-password / reset-password:
 *    sobrevive reinicios, es efectiva entre instancias que compartan la misma
 *    base de datos y no puede ser evadida alternando instancias. El contador
 *    se incrementa con un único UPDATE ... RETURNING atómico (SQLite serializa
 *    escrituras: dos instancias concurrentes no pueden exceder el límite).
 *
 * Confianza de proxies (causa raíz corregida — orden §2.C):
 * `clientIp()` ya no confía ciegamente en `X-Forwarded-For`. Solo se consulta
 * la cabecera cuando el despliegue DECLARA explícitamente TRUST_PROXY=true
 * (nginx/Vercel/Cloudflare delante del servicio); sin esa declaración la
 * cabecera se ignora por completo porque la controla el cliente (spoofing).
 * Con TRUST_PROXY=true se toma el salto DERECHO según TRUST_PROXY_HOPS
 * (default 1): un cliente puede añadir entradas falsas a la IZQUIERDA, pero
 * no puede alterar la dirección que nuestro propio proxy añadió al final.
 */

import { Prisma } from '@prisma/client'
import { db } from './db'

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

/** Solo para pruebas: vacía todas las ventanas en memoria. */
/** (fusión) Reset COMPLETO para pruebas: cubos en memoria Y en la tabla persistente. */
export async function resetAllRateLimits(): Promise<void> {
  resetRateLimits()
  try {
    await db.rateLimitBucket.deleteMany({})
  } catch { /* sin BD (unit puros): nada que limpiar */ }
}

export function resetRateLimits(): void {
  buckets.clear()
}

// ---------- Rate limiting PERSISTENTE (BD) ----------

/**
 * Contador atómico en BD. Un único statement hace upsert + incremento +
 * reinicio de ventana, de modo que N instancias concurrentes comparten el
 * mismo cómputo sin carreras (SQLite serializa escrituras; en PostgreSQL el
 * mismo patrón se expresa con ON CONFLICT ... DO UPDATE).
 *
 * La limpieza de cubos vencidos es perezosa y probabilística (5% de las
 * llamadas) para no encarecer cada intento de login.
 */
export async function dbRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = new Date()
  const windowMsClamped = Math.max(1000, windowMs)
  const newResetAt = new Date(now.getTime() + windowMsClamped)

  // Upsert atómico: cubo nuevo o ventana vencida → count=1; ventana viva → count+1.
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${newResetAt})
    ON CONFLICT("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${newResetAt} ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count", "resetAt"
  `)

  if (Math.random() < 0.05) {
    // Poda perezosa de cubos vencidos (barata: índice resetAt).
    await db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } }).catch(() => null)
  }

  const row = rows[0]
  if (!row) return { ok: true, retryAfter: 0, remaining: limit - 1 } // fail-open acotado: nunca bloquear por ausencia de fila
  const count = row.count
  if (count > limit) {
    const retryAfter = Math.max(1, Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000))
    return { ok: false, retryAfter, remaining: 0 }
  }
  return { ok: true, retryAfter: 0, remaining: limit - count }
}

// ---------- IP del cliente con política de proxies confiables ----------

/** ¿Confiamos en las cabeceras de proxy declaradas por el despliegue? */
export function trustProxyEnabled(): boolean {
  return process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1'
}

/** Saltos de proxy confiables declarados (default 1 cuando TRUST_PROXY=true). */
function trustedHops(): number {
  const n = parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/**
 * IP del cliente para rate limiting.
 *
 * SIN TRUST_PROXY (default): se ignora X-Forwarded-For / X-Real-IP — un cliente
 * puede falsificarlas libremente y saltarse cualquier límite por IP. Se usa la
 * clave 'local' (el límite se aplica igualmente, compartido).
 *
 * CON TRUST_PROXY=true: se toma la entrada DERECHA número TRUST_PROXY_HOPS de
 * X-Forwarded-For (la que añadió nuestro proxy más cercano; no falsificable
 * por el cliente). Solo si no hay XFF se acepta X-Real-IP.
 */
export function clientIp(req: Request): string {
  if (trustProxyEnabled()) {
    const fwd = req.headers.get('x-forwarded-for')
    if (fwd) {
      const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
      const hops = Math.min(trustedHops(), parts.length)
      const ip = parts[parts.length - hops]
      if (ip) return ip.slice(0, 64)
    }
    return req.headers.get('x-real-ip')?.slice(0, 64) || 'local'
  }
  // Sin proxies confiables declarados: las cabeceras del cliente NO valen.
  return 'local'
}
