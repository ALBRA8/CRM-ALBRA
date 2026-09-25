import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  getAuth,
  requireAuth,
  requireAdmin,
  slugify,
  HttpError,
  type SessionPayload,
} from '@/lib/auth'

/**
 * Tests unitarios de src/lib/auth.ts (JWT propio HMAC-SHA256 + scrypt + guardas).
 * No toca BD: los secretos vienen del .env real cargado por el setup global.
 */

const BASE_URL = 'http://localhost:3000/api/anything'

function payload(): Omit<SessionPayload, 'exp'> {
  return { userId: 'u-1', orgId: 'org-1', role: 'owner', email: 'u1@test.albra' }
}

function requestWithAuth(init: { authorization?: string; token?: string } = {}): NextRequest {
  const url = new URL(init.token ? `${BASE_URL}?token=${encodeURIComponent(init.token)}` : BASE_URL)
  const headers = new Headers()
  if (init.authorization) headers.set('authorization', init.authorization)
  return new NextRequest(url, { headers })
}

describe('hashPassword / verifyPassword (scrypt)', () => {
  it('verifica la contraseña correcta tras hashearla', () => {
    const stored = hashPassword('S3cret-Contraseña!')
    expect(stored.startsWith('scrypt:')).toBe(true)
    expect(verifyPassword('S3cret-Contraseña!', stored)).toBe(true)
  })

  it('rechaza una contraseña incorrecta', () => {
    const stored = hashPassword('correcta')
    expect(verifyPassword('incorrecta', stored)).toBe(false)
  })

  it('rechaza formatos almacenados inválidos sin lanzar', () => {
    expect(verifyPassword('x', 'plaintext-sin-formato')).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
    expect(verifyPassword('x', 'bcrypt:salt:hash')).toBe(false)
  })

  it('genera sales distintas para la misma contraseña (sin reproducibilidad)', () => {
    const a = hashPassword('misma')
    const b = hashPassword('misma')
    expect(a).not.toBe(b)
  })
})

describe('signToken / verifyToken (JWT HS256 propio)', () => {
  it('roundtrip: firma y verifica el payload completo', () => {
    const token = signToken(payload(), 7)
    const session = verifyToken(token)
    expect(session).not.toBeNull()
    expect(session?.userId).toBe('u-1')
    expect(session?.orgId).toBe('org-1')
    expect(session?.role).toBe('owner')
    expect(session?.email).toBe('u1@test.albra')
    expect(session?.exp).toBeGreaterThan(Date.now())
  })

  it('rechaza tokens con firma manipulada', () => {
    const token = signToken(payload())
    const parts = token.split('.')
    const forged = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`
    expect(verifyToken(forged)).toBeNull()
  })

  it('rechaza tokens con el payload alterado (firma no coincide)', () => {
    const token = signToken(payload())
    const parts = token.split('.')
    const forged = `${parts[0]}.${Buffer.from(JSON.stringify({ ...payload(), role: 'admin' })).toString('base64url')}.${parts[2]}`
    expect(verifyToken(forged)).toBeNull()
  })

  it('rechaza tokens expirados', () => {
    const expired = signToken(payload(), -1) // exp en el pasado
    expect(verifyToken(expired)).toBeNull()
  })

  it('rechaza payloads sin orgId o userId (sesión multi-tenant estricta)', () => {
    const noOrg = signToken({ userId: 'u-1', role: 'owner', email: 'x@x' } as Omit<SessionPayload, 'exp'>)
    const noUser = signToken({ orgId: 'org-1', role: 'owner', email: 'x@x' } as unknown as Omit<SessionPayload, 'exp'>)
    expect(verifyToken(noOrg)).toBeNull()
    expect(verifyToken(noUser)).toBeNull()
  })

  it('rechaza cadenas que no son un token', () => {
    expect(verifyToken('')).toBeNull()
    expect(verifyToken('no-es-un-token')).toBeNull()
    expect(verifyToken('a.b')).toBeNull()
  })

  it('fail-fast: sin APP_SECRET (o corto) la autenticación es imposible — sin backdoor', () => {
    // Contrato del hardening (crítico #2 auditoría): sin secreto válido,
    // firmar lanza ruidosamente y verificar falla cerrada (null → 401).
    const valid = signToken(payload())
    vi.stubEnv('APP_SECRET', '')
    expect(() => signToken(payload())).toThrow(/APP_SECRET/)
    expect(verifyToken(valid)).toBeNull() // no hay fallback: la firma no verifica
    vi.stubEnv('APP_SECRET', 'corto')
    expect(() => signToken(payload())).toThrow(/APP_SECRET/)
    expect(verifyToken(valid)).toBeNull()
    vi.unstubAllEnvs()
    // Restaurado el secreto real del .env, el mismo token vuelve a verificar.
    expect(verifyToken(valid)).not.toBeNull()
  })
})

describe('getAuth / requireAuth / requireAdmin (guardas de rutas API)', () => {
  it('getAuth extrae sesión de un header Bearer válido', () => {
    const res = getAuth(requestWithAuth({ authorization: `Bearer ${signToken(payload())}` }))
    expect(res).not.toBeNull()
    expect(res?.orgId).toBe('org-1')
    expect(res?.isAdmin).toBe(true) // role owner
  })

  it('getAuth admite ?token= (descargas CSV/PDF/backup)', () => {
    const res = getAuth(requestWithAuth({ token: signToken(payload()) }))
    expect(res?.userId).toBe('u-1')
  })

  it('getAuth devuelve null sin token, con basura o con token firmado por otro secreto', () => {
    expect(getAuth(requestWithAuth())).toBeNull()
    expect(getAuth(requestWithAuth({ authorization: 'Bearer basura.basura.basura' }))).toBeNull()
    expect(getAuth(requestWithAuth({ authorization: 'basura sin bearer' }))).toBeNull()
  })

  it('isAdmin solo con role owner/admin', () => {
    const member = getAuth(requestWithAuth({ authorization: `Bearer ${signToken({ ...payload(), role: 'member' })}` }))
    expect(member?.isAdmin).toBe(false)
    const admin = getAuth(requestWithAuth({ authorization: `Bearer ${signToken({ ...payload(), role: 'admin' })}` }))
    expect(admin?.isAdmin).toBe(true)
  })

  it('requireAuth lanza HttpError 401 sin sesión', () => {
    try {
      requireAuth(requestWithAuth())
      expect.unreachable('requireAuth debía lanzar')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).status).toBe(401)
    }
  })

  it('requireAdmin lanza HttpError 403 para miembros no admin', () => {
    const req = requestWithAuth({ authorization: `Bearer ${signToken({ ...payload(), role: 'member' })}` })
    try {
      requireAdmin(req)
      expect.unreachable('requireAdmin debía lanzar')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).status).toBe(403)
    }
  })

  it('requireAdmin deja pasar a owner', () => {
    const auth = requireAdmin(requestWithAuth({ authorization: `Bearer ${signToken(payload())}` }))
    expect(auth.orgId).toBe('org-1')
  })
})

describe('slugify', () => {
  it('normaliza acentos, minúsculas y separadores', () => {
    expect(slugify('¡Hola, Café con Leche! 123')).toBe('hola-cafe-con-leche-123')
  })

  it('recorta a 40 caracteres y devuelve "org" si queda vacío', () => {
    expect(slugify('Ñandú & Cía. de la Sierra一下子').length).toBeLessThanOrEqual(40)
    expect(slugify('***')).toBe('org')
  })
})
