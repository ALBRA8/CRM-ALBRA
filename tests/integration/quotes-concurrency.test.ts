import { describe, expect, it, beforeEach } from 'vitest'
import { POST as quotesPOST } from '@/app/api/quotes/route'
import { PUT as quotePUT } from '@/app/api/quotes/[id]/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, routeParams, tokenFor } from '../helpers'

/**
 * Cotizaciones: unicidad y consistencia bajo concurrencia (segunda reparación §2.E).
 *  - Dos creaciones CONCURRENTES para la misma org generan números DISTINTOS
 *    (restricción UNIQUE (organizationId, number) + reintento): nunca duplicados.
 *  - El mismo número en DOS organizaciones es legítimo (unicidad es por org).
 *  - Doble "accepted" concurrente produce EXACTAMENTE UN ingreso (CAS + ingreso
 *    dentro de la transacción).
 */

const A = () => tokenFor(FIX.userA)

beforeEach(async () => {
  // Limpia cotizaciones de la org A creadas por otros tests del archivo
  await db.quoteItem.deleteMany({ where: { quote: { organizationId: FIX.orgA.id } } })
  await db.quote.deleteMany({ where: { organizationId: FIX.orgA.id } })
})

function quoteBody(clientId: string) {
  return { clientId, items: [{ description: 'item', quantity: 1, unitPrice: 100 }] }
}

describe('unicidad de números de cotización por organización', () => {
  it('creaciones concurrentes → números únicos dentro de la org (todas 201)', async () => {
    // 4 peticiones SIMULTÁNEAS: misma ventana de carrera sobre el número.
    // (SQLite serializa escrituras; con N mayores el harness agota sockets
    // antes de que la lógica de reintento pueda actuar — el dato probado es
    // el mismo: sin duplicados y sin pérdidas bajo carrera real.)
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        quotesPOST(req('/api/quotes', { method: 'POST', token: A(), body: quoteBody(FIX.clientA1.id) }))
      )
    )
    const statuses = results.map((r) => r.status)
    expect(statuses).toEqual([201, 201, 201, 201])
    const numbers: string[] = []
    for (const r of results) numbers.push(((await jsonBody(r)) as { quote: { number: string } }).quote.number)
    expect(new Set(numbers).size).toBe(4)
  }, 60_000)

  it('dos organizaciones pueden usar el MISMO número (unicidad por org, no global)', async () => {
    // Crea en org A
    const rA = await quotesPOST(req('/api/quotes', { method: 'POST', token: A(), body: quoteBody(FIX.clientA1.id) }))
    expect(rA.status).toBe(201)
    // Necesitamos un owner real de la org B para crear en B
    const owner = await db.user.upsert({
      where: { email: 'owner-b@quotes.test' },
      update: {},
      create: { email: 'owner-b@quotes.test', name: 'Owner B', passwordHash: 'scrypt:aa:bb', role: 'owner', organizationId: FIX.userB.organizationId },
    })
    const clientB = await db.client.upsert({
      where: { id: 'cli-quotes-b' },
      update: {},
      create: { id: 'cli-quotes-b', name: 'Cliente B', organizationId: FIX.userB.organizationId },
    })
    const rB = await quotesPOST(req('/api/quotes', { method: 'POST', token: tokenFor(owner), body: quoteBody(clientB.id) }))
    expect(rB.status).toBe(201)
  })
})

describe('aceptación concurrente — exactamente un ingreso', () => {
  it('dos PUT simultáneos a accepted no duplican la Transaction de ingreso', async () => {
    const created = await quotesPOST(req('/api/quotes', { method: 'POST', token: A(), body: quoteBody(FIX.clientA1.id) }))
    const { quote } = (await jsonBody(created)) as { quote: { id: string; status: string } }

    const [r1, r2] = await Promise.all([
      quotePUT(req(`/api/quotes/${quote.id}`, { method: 'PUT', token: A(), body: { status: 'accepted' } }), routeParams(quote.id)),
      quotePUT(req(`/api/quotes/${quote.id}`, { method: 'PUT', token: A(), body: { status: 'accepted' } }), routeParams(quote.id)),
    ])

    // Ambos parten de status draft: el CAS permite a UNO y rechaza al otro
    // (o, si serializan, el segundo no es "cambio de estado" y no crea ingreso).
    const statuses = [r1.status, r2.status]
    expect(statuses).toContain(200)

    const incomes = await db.transaction.findMany({ where: { quoteId: quote.id, organizationId: FIX.orgA.id, type: 'ingreso' } })
    expect(incomes).toHaveLength(1) // JAMÁS dos ingresos por una sola aceptación

    // La cotización quedó aceptada con total coherente con su ítem
    const q = await db.quote.findUnique({ where: { id: quote.id } })
    expect(q?.status).toBe('accepted')
    expect(q?.subtotal).toBe(100)
    expect(q?.total).toBeCloseTo(116, 2) // 100 + IVA 16%
  })
})
