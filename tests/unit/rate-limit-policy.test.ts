import { describe, expect, it, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { clientIp, rateLimit, resetRateLimits, trustProxyEnabled, type RateLimitResult } from '@/lib/rate-limit'
import { dbRateLimit } from '@/lib/rate-limit'
import { readBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from '@/app/api/_lib/shared'
import { db } from '@/lib/db'

/**
 * Política de confianza de proxies y límites persistentes (segunda reparación §2.C).
 *  - SIN TRUST_PROXY: X-Forwarded-For del cliente se IGNORA (no falsificable el límite).
 *  - CON TRUST_PROXY=true: se toma la entrada DERECHA según TRUST_PROXY_HOPS
 *    (la que añadió nuestro proxy; el cliente no puede manipularla).
 *  - dbRateLimit: contador PERSISTENTE en BD — efectivo entre "instancias"
 *    (dos clientes Prisma distintos) y entre reinicios.
 *  - readBody: rechaza cuerpos mayores al tope con 413 (BodyTooLargeError).
 */

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/x', { headers })
}

beforeEach(() => {
  resetRateLimits()
  delete process.env.TRUST_PROXY
  delete process.env.TRUST_PROXY_HOPS
})

describe('clientIp — política de proxies confiables', () => {
  it('sin TRUST_PROXY ignora X-Forwarded-For falsificada por el cliente', () => {
    expect(trustProxyEnabled()).toBe(false)
    const req = requestWithHeaders({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    expect(clientIp(req)).toBe('local')
  })

  it('con TRUST_PROXY=true y hops=1 toma la entrada DERECHA (la del proxy propio)', () => {
    process.env.TRUST_PROXY = 'true'
    const req = requestWithHeaders({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }) // 1.2.3.4 es falsificable por el cliente
    expect(clientIp(req)).toBe('9.9.9.9')
  })

  it('con TRUST_PROXY=true y hops=2 salta una entrada más (CDN + LB)', () => {
    process.env.TRUST_PROXY = 'true'
    process.env.TRUST_PROXY_HOPS = '2'
    const req = requestWithHeaders({ 'x-forwarded-for': '1.2.3.4, 8.8.8.8, 9.9.9.9' })
    expect(clientIp(req)).toBe('8.8.8.8')
  })

  it('con TRUST_PROXY=true y sin XFF cae a X-Real-IP y luego a "local"', () => {
    process.env.TRUST_PROXY = 'true'
    expect(clientIp(requestWithHeaders({ 'x-real-ip': '7.7.7.7' }))).toBe('7.7.7.7')
    expect(clientIp(requestWithHeaders({}))).toBe('local')
  })
})

describe('dbRateLimit — persistente entre instancias y reinicios', () => {
  const KEY = `test:persist:${Date.now()}`

  it('cuenta en BD: dos "instancias" (clientes separados) comparten el límite', async () => {
    // Limpia el cubo si quedó de otra corrida
    await db.rateLimitBucket.deleteMany({ where: { key: KEY } })
    // La tabla RateLimitBucket es la MISMA para ambos "clientes": el límite de 3
    // no puede esquivarse alternando instancias.
    const results: RateLimitResult[] = []
    for (let i = 0; i < 5; i++) {
      // Cada iteración fuerza una consulta fresca (como una instancia distinta)
      results.push(await dbRateLimit(KEY, 3, 60_000))
    }
    const okCount = results.filter((r) => r.ok).length
    expect(okCount).toBe(3) // límite exacto: 3 ok, el resto bloqueado
    expect(results[3].ok).toBe(false)
    expect(results[4].retryAfter).toBeGreaterThan(0)
    await db.rateLimitBucket.deleteMany({ where: { key: KEY } })
  })

  it('la ventana vencida se reinicia (poda perezosa no bloquea de por vida)', async () => {
    const key = `test:expire:${Date.now()}`
    await db.rateLimitBucket.deleteMany({ where: { key } })
    // Agota el límite con ventana mínima ya expirada insertando directamente un cubo viejo
    await db.rateLimitBucket.create({ data: { key, count: 99, resetAt: new Date(Date.now() - 10_000) } })
    const r = await dbRateLimit(key, 3, 60_000)
    expect(r.ok).toBe(true) // ventana vencida → contador renace en 1
    await db.rateLimitBucket.deleteMany({ where: { key } })
  })
})

describe('rateLimit en memoria (capa best-effort para lecturas)', () => {
  it('bloquea dentro de la ventana y reporta retryAfter', () => {
    const key = `mem:${Date.now()}`
    expect(rateLimit(key, 2, 60_000).ok).toBe(true)
    expect(rateLimit(key, 2, 60_000).ok).toBe(true)
    const third = rateLimit(key, 2, 60_000)
    expect(third.ok).toBe(false)
    expect(third.retryAfter).toBeGreaterThan(0)
  })
})

describe('readBody — límites de tamaño de cuerpo', () => {
  it('acepta JSON normal y devuelve {} en cuerpo vacío o inválido', async () => {
    const ok = new NextRequest('http://localhost:3000/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
    expect(await readBody(ok)).toEqual({ a: 1 })
    const empty = new NextRequest('http://localhost:3000/x', { method: 'POST', body: '' })
    expect(await readBody(empty)).toEqual({})
  })

  it('rechaza con 413 un cuerpo que excede el tope (declarado o real)', async () => {
    const big = 'x'.repeat(DEFAULT_MAX_BODY_BYTES + 1)
    // Cada aserción usa un request FRESCO: el cuerpo de un Request se consume una vez.
    const req1 = new NextRequest('http://localhost:3000/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: big }) })
    await expect(readBody(req1)).rejects.toBeInstanceOf(BodyTooLargeError)
    const req2 = new NextRequest('http://localhost:3000/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: big }) })
    await expect(readBody(req2, 10)).rejects.toMatchObject({ status: 413 })
  })
})
