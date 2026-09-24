import type { Opportunity, Quote } from '@prisma/client'
import { isObjArray, num, parseJson, str } from './shared'
import { serializeClientRef } from './clients'

/**
 * Cotizaciones: `number` se expone también como `quoteNumber` (el frontend lo
 * consume así). El descuento se envía como porcentaje y se recalcula como
 * monto absoluto al leer: discount = subtotal - (total - tax).
 */

export interface QuoteItemParsed {
  sku: string | null
  description: string
  quantity: number
  unitPrice: number
}

export function parseQuoteItems(raw: string | null): QuoteItemParsed[] {
  const arr = parseJson<unknown>(raw, [])
  if (!Array.isArray(arr)) return []
  return arr
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((it) => ({
      sku: str(it.sku),
      description: str(it.description) ?? '',
      quantity: num(it.quantity, 1) || 1,
      unitPrice: num(it.unitPrice, 0),
    }))
}

export function itemsFromBody(body: Record<string, unknown>): QuoteItemParsed[] | null {
  if (!isObjArray(body.items)) return null
  return body.items.map((it) => ({
    sku: str(it.sku),
    description: str(it.description) ?? '',
    quantity: num(it.quantity, 1) || 1,
    unitPrice: num(it.unitPrice, 0),
  }))
}

export function computeQuoteTotals(items: QuoteItemParsed[], discountPct: number) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const discount = subtotal * (discountPct / 100)
  const base = subtotal - discount
  const tax = base * 0.16
  const total = base + tax
  return { subtotal, discount, tax, total }
}

/** Número secuencial COT-0001 por organización (a prueba de colisiones simples). */
export async function nextQuoteNumber(orgId: string): Promise<string> {
  const { db } = await import('@/lib/db')
  let n = (await db.quote.count({ where: { organizationId: orgId } })) + 1
  let number = `COT-${String(n).padStart(4, '0')}`
  // Evita colisión si se borraron/crearon cotizaciones en paralelo
  for (let guard = 0; guard < 50; guard++) {
    const exists = await db.quote.findFirst({ where: { organizationId: orgId, number }, select: { id: true } })
    if (!exists) return number
    n += 1
    number = `COT-${String(n).padStart(4, '0')}`
  }
  return `COT-${Date.now().toString().slice(-6)}`
}

export function quoteDiscountAmount(q: Pick<Quote, 'subtotal' | 'tax' | 'total'>): number {
  return Math.max(0, q.subtotal - (q.total - q.tax))
}

interface QuoteRecordLike {
  id: string
  number: string
  items: string
  subtotal: number
  tax: number
  total: number
  currency: string
  status: string
  validUntil: Date | null
  notes: string | null
  opportunityId: string | null
  createdAt: Quote['createdAt']
  updatedAt: Quote['updatedAt']
  client?: { id: string; name: string; email: string | null; phone: string | null; address: string | null } | null
  opportunity?: Pick<Opportunity, 'id' | 'title'> | null
}

export function serializeQuote(
  q: QuoteRecordLike,
  opts?: { includeItems?: boolean; clientAttrs?: Parameters<typeof serializeClientRef>[1] }
): Record<string, unknown> {
  const items = parseQuoteItems(q.items)
  return {
    id: q.id,
    quoteNumber: q.number,
    number: q.number,
    status: q.status,
    subtotal: q.subtotal,
    discount: quoteDiscountAmount(q),
    tax: q.tax,
    total: q.total,
    currency: q.currency,
    validUntil: q.validUntil,
    notes: q.notes,
    client: q.client ? serializeClientRef(q.client, opts?.clientAttrs) : null,
    opportunity: q.opportunity ? { id: q.opportunity.id, title: q.opportunity.title } : null,
    opportunityId: q.opportunityId,
    items: opts?.includeItems === false
      ? undefined
      : items.map((it, idx) => ({
          id: `${q.id}-item-${idx + 1}`,
          sku: it.sku,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.quantity * it.unitPrice,
        })),
    _count: { items: items.length },
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  }
}
