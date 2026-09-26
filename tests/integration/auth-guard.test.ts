import { describe, expect, it } from 'vitest'
import { GET as clientsGET } from '@/app/api/clients/route'
import { POST as logoutPOST } from '@/app/api/auth/logout/route'
import { POST as demoPOST } from '@/app/api/auth/demo/route'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'
import { SESSION_COOKIE } from '@/lib/auth'

/**
 * Auth guard sobre /api/clients (handler real de Next invocado como función):
 * - sin token → 401
 * - token basura → 401
 * - token válido (owner o member) → 200 con el listado de la organización
 * - cookie httpOnly (sin Bearer) → 200 (modo dual; cierre Fase 1 XSS)
 * - login fija Set-Cookie httpOnly; logout la expira
 */

describe('auth guard — GET /api/clients', () => {
  it('rechaza sin token con 401', async () => {
    const res = await clientsGET(req('/api/clients'))
    expect(res.status).toBe(401)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/token/i)
  })

  it('rechaza un token inválido/firmado con otro secreto con 401', async () => {
    const res = await clientsGET(req('/api/clients', { token: 'basura.basura.basura' }))
    expect(res.status).toBe(401)
  })

  it('acepta un token Bearer válido (owner org A) con 200 y datos de la org', async () => {
    const res = await clientsGET(req('/api/clients', { token: tokenA() }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const clients = body.clients as Array<{ id: string; name: string }>
    expect(Array.isArray(clients)).toBe(true)
    expect(clients.map((c) => c.id).sort()).toEqual([FIX.clientA1.id, FIX.clientA2.id].sort())
  })

  it('un member (no admin) también puede listar — el guard de lectura no exige admin', async () => {
    const res = await clientsGET(req('/api/clients', { token: tokenB() }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(Array.isArray(body.clients)).toBe(true)
  })

  it('acepta el fallback ?token= usado por las descargas directas', async () => {
    const res = await clientsGET(req(`/api/clients?token=${encodeURIComponent(tokenA())}`))
    expect(res.status).toBe(200)
  })
})

describe('auth por cookie httpOnly (modo dual)', () => {
  it('autentica SOLO con la cookie de sesión (sin header Bearer)', async () => {
    const res = await clientsGET(req('/api/clients', { cookie: `${SESSION_COOKIE}=${tokenA()}` }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(Array.isArray(body.clients)).toBe(true)
  })

  it('rechaza una cookie de sesión inválida con 401', async () => {
    const res = await clientsGET(req('/api/clients', { cookie: `${SESSION_COOKIE}=no-es-un-jwt` }))
    expect(res.status).toBe(401)
  })

  it('prioriza el header Bearer sobre la cookie (evita conflictos multi-cuenta)', async () => {
    // Bearer de org A + cookie "rota": si el Bearer gana, responde 200
    const res = await clientsGET(req('/api/clients', {
      token: tokenA(),
      cookie: `${SESSION_COOKIE}=no-es-un-jwt`,
    }))
    expect(res.status).toBe(200)
  })

  it('login fija Set-Cookie httpOnly con la sesión', async () => {
    // FIX.userA tiene passwordHash sintético no verificable; para validar el
    // contrato Set-Cookie usamos el flujo demo (no requiere credenciales).
    const res = await demoPOST(req('/api/auth/demo', { method: 'POST' }))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toContain(`${SESSION_COOKIE}=`)
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
  })

  it('logout expira la cookie de sesión (max-age=0)', async () => {
    const res = await logoutPOST(req('/api/auth/logout', { method: 'POST' }))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toContain(`${SESSION_COOKIE}=`)
    expect(setCookie.toLowerCase()).toContain('max-age=0')
  })
})
