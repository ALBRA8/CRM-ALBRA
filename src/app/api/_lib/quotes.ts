import type { Opportunity, Quote, QuoteItem, PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { isObjArray, num, str } from './shared'
import { serializeClientRef } from './clients'

/** Cliente Prisma transaccional (para operaciones dentro de $transaction). */
export type TxClient = Prisma.TransactionClient
/** Cliente por defecto cuando no se pasa un tx: el db global (PrismaClient). */
type DbLike = TxClient | PrismaClient

/** Resuelve el cliente a usar (tx explícito o el db global con import perezoso). */
async function resolveClient(client?: DbLike): Promise<DbLike> {
  if (client) return client
  const { db } = await import('@/lib/db')
  return db
}

/**
 * Cotizaciones: `number` se expone también como `quoteNumber` (el frontend lo
 * consume así). Los items viven en la tabla relacional QuoteItem (con sku y
 * posición). El descuento se envía como porcentaje y se recalcula como monto
 * absoluto al leer: discount = subtotal - (total - tax).
 */

export interface QuoteItemParsed {
  sku: string | null
  description: string
  quantity: number
  unitPrice: number
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

/** Items listos para `create`/`update` anidado (Prisma resuelve el quoteId). */
export function quoteItemRows(items: QuoteItemParsed[], organizationId?: string) {
  return items.map((it, idx) => ({
    ...(organizationId ? { organizationId } : {}),
    sku: it.sku,
    description: it.description,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    subtotal: it.quantity * it.unitPrice,
    position: idx,
  }))
}

/** ¿Es un error P2002 (violación de unicidad) de Prisma? */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002'
}

/**
 * Número secuencial COT-0001 por organización.
 *
 * (segunda reparación §2.E) ASIGNACIÓN ATÓMICA: el número sale de un contador
 * por organización incrementado con UN solo statement (upsert + RETURNING) —
 * sin transacción interactiva en el camino caliente. N creaciones concurrentes
 * serializan limpiamente en SQLite y cada una recibe un número distinto. La
 * restricción UNIQUE (organizationId, number) es la defensa final y la ruta
 * reintenta ante P2002 (p. ej. tras una restauración que sufijó números).
 */
export async function nextQuoteNumber(orgId: string, client?: DbLike): Promise<string> {
  const c = await resolveClient(client)
  const key = `quote:${orgId}`
  const rows = await c.$queryRaw<{ value: number | bigint }[]>(
    Prisma.sql`INSERT INTO "OrgCounter" ("key", "value") VALUES (${key}, 1)
      ON CONFLICT("key") DO UPDATE SET "value" = "OrgCounter"."value" + 1
      RETURNING "value"`
  )
  let n = Number(rows[0]?.value ?? 1)
  // Salta números ya ocupados (restauraciones con sufijos, datos previos al contador)
  for (let guard = 0; guard < 50; guard++) {
    const number = `COT-${String(n).padStart(4, '0')}`
    const exists = await c.quote.findFirst({ where: { organizationId: orgId, number }, select: { id: true } })
    if (!exists) return number
    n += 1
  }
  return `COT-${Date.now().toString().slice(-6)}`
}

export function quoteDiscountAmount(q: Pick<Quote, 'subtotal' | 'tax' | 'total'>): number {
  return Math.max(0, q.subtotal - (q.total - q.tax))
}

interface QuoteRecordLike {
  id: string
  number: string
  items: QuoteItem[]
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
  const items = [...(q.items ?? [])].sort((a, b) => a.position - b.position)
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
      : items.map((it) => ({
          id: it.id,
          sku: it.sku,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal ?? it.quantity * it.unitPrice,
        })),
    _count: { items: items.length },
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  }
}
