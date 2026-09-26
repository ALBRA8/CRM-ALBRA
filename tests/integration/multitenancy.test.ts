import { describe, expect, it } from 'vitest'
import { GET as clientsGET } from '@/app/api/clients/route'
import { GET as clientDetailGET } from '@/app/api/clients/[id]/route'
import { FIX, jsonBody, req, routeParams, tokenA, tokenB } from '../helpers'

/**
 * MULTI-TENANCIA (bloqueador #1 de la auditoría): los datos de la org A
 * jamás deben aparecer en lecturas de la org B, ni en listado ni por ID.
 */

describe('aislamiento multi-tenant en /api/clients', () => {
  it('el listado de org B NO contiene clientes de org A (y viceversa)', async () => {
    const resB = await clientsGET(req('/api/clients', { token: tokenB() }))
    expect(resB.status).toBe(200)
    const bodyB = await jsonBody(resB)
    const clientsB = bodyB.clients as Array<{ id: string; name: string }>
    expect(clientsB.map((c) => c.id)).toEqual([FIX.clientB1.id])
    expect(clientsB.map((c) => c.name)).not.toContain(FIX.clientA1.name)

    const resA = await clientsGET(req('/api/clients', { token: tokenA() }))
    const clientsA = ((await jsonBody(resA)).clients as Array<{ id: string }>).map((c) => c.id)
    expect(clientsA).not.toContain(FIX.clientB1.id)
  })

  it('GET /api/clients/:id de otra organización → 404 (no 403: no se filtra su existencia)', async () => {
    const resAsB = await clientDetailGET(req('/api/clients/' + FIX.clientA1.id, { token: tokenB() }), routeParams(FIX.clientA1.id))
    expect(resAsB.status).toBe(404)

    // El dueño sí lo ve.
    const resAsA = await clientDetailGET(req('/api/clients/' + FIX.clientA1.id, { token: tokenA() }), routeParams(FIX.clientA1.id))
    expect(resAsA.status).toBe(200)
    const bodyA = await jsonBody(resAsA)
    expect((bodyA.client as { id: string }).id).toBe(FIX.clientA1.id)
  })

  it('un id inexistente también responde 404', async () => {
    const res = await clientDetailGET(req('/api/clients/no-existe', { token: tokenA() }), routeParams('no-existe'))
    expect(res.status).toBe(404)
  })
})
