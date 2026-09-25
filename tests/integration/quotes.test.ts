import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { GET as quotesGET, POST as quotesPOST } from '@/app/api/quotes/route'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'

/**
 * Cotizaciones con QuoteItem relacional (Task 10):
 * - POST /api/quotes con items anidados crea filas QuoteItem reales (position,
 *   subtotal) y recalcula subtotal/descuento/IVA/total;
 * - GET aislado por organización;
 * - validaciones (cliente inexistente, sin items).
 *
 * Cálculo esperado para [{qty 2 × 100}, {qty 1 × 50}] con descuento 10%:
 *   subtotal 250 → descuento 25 → base 225 → IVA 16% = 36 → total 261.
 */

interface QuotePayload {
  quote: {
    id: string
    quoteNumber: string
    number: string
    subtotal: number
    discount: number
    tax: number
    total: number
    currency: string
    items: Array<{ id: string; sku: string | null; description: string; quantity: number; unitPrice: number; subtotal: number }>
    client: { id: string } | null
    _count: { items: number }
  }
}

describe('POST /api/quotes — QuoteItem relacional', () => {
  it('crea la cotización con items anidados, número secuencial y totales correctos', async () => {
    const res = await quotesPOST(
      req('/api/quotes', {
        method: 'POST',
        token: tokenA(),
        body: {
          clientId: FIX.clientA1.id,
          items: [
            { sku: 'SKU-001', description: 'Consultoría inicial', quantity: 2, unitPrice: 100 },
            { description: 'Soporte mensual', quantity: 1, unitPrice: 50 },
          ],
          discount: 10,
          currency: 'USD',
        },
      })
    )
    expect(res.status).toBe(201)
    const body = (await jsonBody(res)) as unknown as QuotePayload
    const quote = body.quote

    expect(quote.quoteNumber).toBe('COT-0001') // BD recién sembrada: primera cotización
    expect(quote.number).toBe('COT-0001')
    expect(quote.subtotal).toBe(250)
    expect(quote.discount).toBe(25)
    expect(quote.tax).toBeCloseTo(36, 5)
    expect(quote.total).toBeCloseTo(261, 5)
    expect(quote.currency).toBe('USD')
    expect(quote.client?.id).toBe(FIX.clientA1.id)

    // Items serializados ordenados por position
    expect(quote.items).toHaveLength(2)
    expect(quote.items[0]).toMatchObject({ sku: 'SKU-001', quantity: 2, unitPrice: 100, subtotal: 200 })
    expect(quote.items[1]).toMatchObject({ sku: null, description: 'Soporte mensual', quantity: 1, unitPrice: 50, subtotal: 50 })
    expect(quote._count.items).toBe(2)

    // Las filas QuoteItem existen realmente en la tabla relacional
    const rows = await db.quoteItem.findMany({ where: { quoteId: quote.id }, orderBy: { position: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ sku: 'SKU-001', quantity: 2, unitPrice: 100, subtotal: 200, position: 0 })
    expect(rows[1]).toMatchObject({ quantity: 1, unitPrice: 50, subtotal: 50, position: 1 })
  })

  it('rechaza 400 si el cliente no existe o pertenece a otra organización', async () => {
    const res = await quotesPOST(
      req('/api/quotes', {
        method: 'POST',
        token: tokenA(),
        body: { clientId: FIX.clientB1.id, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] },
      })
    )
    expect(res.status).toBe(400)
  })

  it('rechaza 400 si la cotización no tiene items', async () => {
    const res = await quotesPOST(
      req('/api/quotes', { method: 'POST', token: tokenA(), body: { clientId: FIX.clientA1.id, items: [] } })
    )
    expect(res.status).toBe(400)
    const resNoItems = await quotesPOST(
      req('/api/quotes', { method: 'POST', token: tokenA(), body: { clientId: FIX.clientA1.id } })
    )
    expect(resNoItems.status).toBe(400)
  })

  it('rechaza 400 si faltan campos requeridos (clientId)', async () => {
    const res = await quotesPOST(
      req('/api/quotes', { method: 'POST', token: tokenA(), body: { items: [{ description: 'x' }] } })
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/quotes — listado multi-tenant', () => {
  it('org A ve su cotización con items; org B no ve nada de org A', async () => {
    // Crear una cotización para el cliente A2 y filtrar por él: aísla el test
    // de las cotizaciones creadas por los tests anteriores del mismo archivo.
    const created = await quotesPOST(
      req('/api/quotes', {
        method: 'POST',
        token: tokenA(),
        body: { clientId: FIX.clientA2.id, items: [{ description: 'Item A', quantity: 1, unitPrice: 10 }] },
      })
    )
    expect(created.status).toBe(201)
    const createdQuote = ((await jsonBody(created)) as unknown as QuotePayload).quote

    const resA = await quotesGET(req(`/api/quotes?clientId=${FIX.clientA2.id}`, { token: tokenA() }))
    expect(resA.status).toBe(200)
    const bodyA = await jsonBody(resA)
    const quotesA = bodyA.quotes as Array<{ quoteNumber: string; items: unknown[] }>
    expect(quotesA).toHaveLength(1)
    expect(quotesA[0].quoteNumber).toBe(createdQuote.quoteNumber)
    expect(quotesA[0].items).toHaveLength(1)

    const resB = await quotesGET(req('/api/quotes', { token: tokenB() }))
    const quotesB = ((await jsonBody(resB)).quotes as unknown[]).length
    expect(quotesB).toBe(0)
  })
})
