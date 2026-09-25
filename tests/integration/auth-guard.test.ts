import { describe, expect, it } from 'vitest'
import { GET as clientsGET } from '@/app/api/clients/route'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'

/**
 * Auth guard sobre /api/clients (handler real de Next invocado como función):
 * - sin token → 401
 * - token basura → 401
 * - token válido (owner o member) → 200 con el listado de la organización
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
