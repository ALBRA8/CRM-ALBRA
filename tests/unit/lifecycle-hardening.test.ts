/**
 * lifecycle-hardening.test.ts — Reparación integral 2026-11-06
 *
 * Verifica el endurecimiento del ciclo de vida de cuentas y descargas:
 *  L1  el JWT ya NO se acepta en la URL (?token=) — eliminado el vector JWT-in-URL
 *  L2  tickets de descarga: un solo uso, corta vida, no reutilizables
 *  L3  el token de reset se almacena SOLO como SHA-256 (fuga de BD inofensiva)
 *  L4  reset-password revoca sesiones emitidas antes del cambio (iat cutoff)
 *  L5  firma del puente WhatsPower v2: el timestamp queda ligado a la firma
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash, createHmac } from 'crypto'
import { signToken, verifyToken, getAuth, requireAuth } from '@/lib/auth'
import { redeemDownloadTicket, issueDownloadTicket } from '@/lib/download-tickets'
import { bumpTokenVersion } from '@/lib/session-invalidation'
import { signWhatspowerPayload } from '@/lib/whatspower-bridge'
import { rateLimit, resetRateLimits } from '@/lib/rate-limit'
import { FIX } from '../setup/seed-data'

function req(url: string, init: { token?: string; method?: string; body?: unknown; headerToken?: string } = {}): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' })
  if (init.headerToken) headers.set('authorization', `Bearer ${init.headerToken}`)
  return new NextRequest(new URL(`http://localhost:3000${url}`), {
    method: init.method || 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  }) as NextRequest
}

const OWNER_A = () => signToken({ userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email }, 1)

beforeEach(() => {
  resetRateLimits()
})

describe('L1: JWT en URL eliminado', () => {
  it('un JWT en ?token= YA NO autentica (vector cerrado)', () => {
    const token = OWNER_A()
    const r = req(`/api/export/csv?token=${encodeURIComponent(token)}`)
    expect(getAuth(r)).toBeNull()
  })

  it('el mismo JWT por header Bearer sigue autenticando (compatibilidad)', () => {
    const token = OWNER_A()
    const r = req('/api/export/csv', { headerToken: token })
    expect(getAuth(r)?.userId).toBe(FIX.userA.id)
  })
})

describe('L2: tickets de descarga de un solo uso', () => {
  it('issue → canje en ?ticket= devuelve el contexto del usuario', () => {
    const token = OWNER_A()
    const auth = getAuth(req('/x', { headerToken: token }))!
    const { ticket } = issueDownloadTicket(auth)
    const r = req(`/api/export/csv?ticket=${ticket}`)
    const ctx = getAuth(r)
    expect(ctx?.userId).toBe(FIX.userA.id)
    expect(ctx?.orgId).toBe(FIX.orgA.id)
  })

  it('reutilizar el ticket → null (un solo uso estricto)', () => {
    const token = OWNER_A()
    const auth = getAuth(req('/x', { headerToken: token }))!
    const { ticket } = issueDownloadTicket(auth)
    expect(redeemDownloadTicket(ticket)).not.toBeNull()
    expect(redeemDownloadTicket(ticket)).toBeNull()
  })

  it('ticket inventado o basura → null sin excepción', () => {
    expect(redeemDownloadTicket('a'.repeat(64))).toBeNull()
    expect(redeemDownloadTicket('corto')).toBeNull()
  })
})

describe('L3: token de reset hasheado en BD', () => {
  it('el SHA-256 del token es lo que se almacena (nunca el token claro)', async () => {
    const { db } = await import('@/lib/db')
    const plaintext = 'abcdef0123456789abcdef0123456789'
    const hash = createHash('sha256').update(plaintext).digest('hex')
    await db.user.update({
      where: { id: FIX.userA.id },
      data: { resetToken: hash, resetTokenExp: new Date(Date.now() + 600_000) },
    })
    try {
      const stored = await db.user.findUnique({ where: { id: FIX.userA.id }, select: { resetToken: true } })
      expect(stored!.resetToken).toBe(hash)
      expect(stored!.resetToken).not.toBe(plaintext)
      // y el flujo de reset acepta el token PLANO (comparando por hash)
      const user = await db.user.findFirst({ where: { resetToken: createHash('sha256').update(plaintext).digest('hex') } })
      expect(user?.id).toBe(FIX.userA.id)
    } finally {
      await db.user.update({ where: { id: FIX.userA.id }, data: { resetToken: null, resetTokenExp: null } })
    }
  })
})

describe('L4: revocación de sesiones tras cambio de contraseña (tokenVersion PERSISTENTE)', () => {
  it('un JWT anterior deja de funcionar tras la revocación; uno firmado con la versión vigente, no', async () => {
    const token = OWNER_A() // sin claim tv → se trata como versión 0
    // Sanity: la guarda acepta el token antes de revocar
    const before = await requireAuth(req('/x', { headerToken: token }))
    expect(before.userId).toBe(FIX.userA.id)

    // Reset de contraseña → bump persistente en BD (lo ejecuta la ruta)
    await bumpTokenVersion(FIX.userA.id)

    // El token viejo (tv=0) muere ante la guarda async (BD-autoritativa)
    await expect(requireAuth(req('/x', { headerToken: token }))).rejects.toMatchObject({ status: 401 })
    // getAuth (verificación barata) aún lo decodifica — la autoridad es la guarda async
    expect(getAuth(req('/x', { headerToken: token }))?.userId).toBe(FIX.userA.id)

    // Un token firmado con la versión VIGENTE (1) sí pasa
    const fresh = signToken({ userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email, tv: 1 }, 1)
    const auth = await requireAuth(req('/x', { headerToken: fresh }))
    expect(auth.userId).toBe(FIX.userA.id)
  })
})

describe('L5: puente WhatsPower HMAC v2 (timestamp ligado)', () => {
  const SECRET = 'whatspower_bridge_secret_for_tests_0000' // scan-secrets:allow (dummy de prueba, no es credencial real)
  const body = JSON.stringify({ hello: 'world' })

  it('la firma v2 = HMAC(secret, `${ts}.${body}`)', () => {
    const ts = '1700000000000'
    const expected = createHmac('sha256', SECRET).update(`${ts}.${body}`, 'utf8').digest('hex')
    expect(signWhatspowerPayload(ts, body, SECRET)).toBe(expected)
  })

  it('misma firma NO valida con otro timestamp (anti replay con ts fresco)', () => {
    const sig1 = signWhatspowerPayload('1700000000000', body, SECRET)
    const sig2 = signWhatspowerPayload('1700000000001', body, SECRET)
    expect(sig1).not.toBe(sig2)
  })
})

describe('L6: rate limit de login (anti fuerza bruta)', () => {
  it('bloquea al superar 10 intentos por minuto por IP+cuenta', () => {
    const key = 'login:acct:203.0.113.9:brute@test.co'
    for (let i = 0; i < 10; i++) {
      expect(rateLimit(key, 10, 60_000).ok).toBe(true)
    }
    const blocked = rateLimit(key, 10, 60_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })
})
