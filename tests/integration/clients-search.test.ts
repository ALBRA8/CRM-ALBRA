import { describe, expect, it } from 'vitest'
import { GET as clientsGET } from '@/app/api/clients/route'
import { FIX, jsonBody, req, tokenA } from '../helpers'

/**
 * Integración: búsqueda unificada de clientes (GET /api/clients?search=…).
 * El combobox de "Nueva Oportunidad" depende de que la búsqueda cubra
 * NOMBRE, TELÉFONO, CÉDULA y CORREO (petición del usuario: con muchos
 * clientes el desplegable plano era inutilizable).
 */

async function searchIds(q: string): Promise<string[]> {
  const res = await clientsGET(req('/api/clients?search=' + encodeURIComponent(q), { token: tokenA() }))
  expect(res.status).toBe(200)
  const body = await jsonBody(res)
  return ((body.clients as Array<{ id: string }>)).map((c) => c.id)
}

describe('búsqueda de clientes por identificador', () => {
  it('encuentra por fragmento de cédula (con prefijo CC-)', async () => {
    const ids = await searchIds('CC-10234567')
    expect(ids).toContain(FIX.clientA1.id)
    expect(ids).not.toContain(FIX.clientB1.id)
  })

  it('encuentra por cédula sin prefijo (solo dígitos)', async () => {
    const ids = await searchIds('1023456789')
    expect(ids).toContain(FIX.clientA1.id)
  })

  it('encuentra por teléfono ignorando el formato (+57 y espacios)', async () => {
    const ids = await searchIds('+57 300 111 0000')
    expect(ids).toContain(FIX.clientA1.id)
  })

  it('encuentra por correo y por nombre', async () => {
    expect(await searchIds('alpha@test.albra')).toContain(FIX.clientA1.id)
    expect(await searchIds('Alpha')).toContain(FIX.clientA1.id)
  })

  it('query sin coincidencias devuelve lista vacía (no error)', async () => {
    const ids = await searchIds('no-existe-ni-paris')
    expect(ids).not.toContain(FIX.clientA1.id)
  })
})
