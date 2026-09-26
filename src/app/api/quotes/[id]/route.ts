import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { handle, json, readBody, str, dateOrNull, numOrNull, clamp } from '../../_lib/shared'
import { loadClientAttrs } from '../../_lib/clients'
import { computeQuoteTotals, itemsFromBody, quoteItemRows, quoteDiscountAmount, serializeQuote } from '../../_lib/quotes'

const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Expirada',
}

/** GET /api/quotes/:id — detalle con items, cliente y oportunidad. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const quote = await db.quote.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true, address: true } },
        opportunity: { select: { id: true, title: true } },
        items: { orderBy: { position: 'asc' } },
      },
    })
    if (!quote) throw new HttpError(404, 'Cotización no encontrada')

    const attrs = quote.client ? (await loadClientAttrs(auth.orgId, [quote.client.id])).get(quote.client.id) : undefined
    return json({ quote: serializeQuote(quote, { clientAttrs: attrs }) })
  })
}

/**
 * PUT /api/quotes/:id — cambio de estado (y otros campos). Al aceptar la
 * cotización se genera la Transaction de ingreso + trigger quote_status_changed.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.quote.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { items: { orderBy: { position: 'asc' } } },
    })
    if (!existing) throw new HttpError(404, 'Cotización no encontrada')
    const body = await readBody(req)

    const data: Record<string, unknown> = {}

    // Recalcula totales si cambian items o descuento
    const newItems = itemsFromBody(body)
    const hasDiscount = 'discount' in body
    if (newItems || hasDiscount) {
      const items = newItems ?? existing.items.sort((a, b) => a.position - b.position).map((it) => ({ sku: it.sku, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice }))
      // % de descuento: si el body lo trae se usa; si no, se deriva del monto guardado
      const prevDiscountAmount = quoteDiscountAmount(existing)
      const derivedPct = existing.subtotal > 0 ? (prevDiscountAmount / existing.subtotal) * 100 : 0
      const pct = clamp(hasDiscount ? numOrNull(body.discount) ?? 0 : derivedPct, 0, 100)
      const totals = computeQuoteTotals(items, pct)
      data.subtotal = totals.subtotal
      data.tax = totals.tax
      data.total = totals.total
    }

    if ('currency' in body) data.currency = str(body.currency) ?? existing.currency
    if ('validUntil' in body) data.validUntil = dateOrNull(body.validUntil)
    if ('notes' in body) data.notes = str(body.notes)
    if ('opportunityId' in body) {
      const opportunityId = str(body.opportunityId)
      if (opportunityId) {
        const opp = await db.opportunity.findFirst({ where: { id: opportunityId, organizationId: auth.orgId }, select: { id: true } })
        if (!opp) throw new HttpError(400, 'Oportunidad no encontrada')
      }
      data.opportunityId = opportunityId
    }

    // Estado
    const newStatus = str(body.status)
    const statusChanged = Boolean(newStatus && newStatus !== existing.status)
    if (newStatus) data.status = newStatus

    if (Object.keys(data).length === 0 && !newItems) {
      return json({ quote: serializeQuote(existing) })
    }

    // Actualiza campos + reemplaza items en una transacción
    const updated = await db.$transaction(async (tx) => {
      if (newItems) {
        await tx.quoteItem.deleteMany({ where: { quoteId: id } })
        await tx.quoteItem.createMany({ data: quoteItemRows(newItems).map((r) => ({ ...r, quoteId: id })) })
      }
      return tx.quote.update({
        where: { id },
        data,
        include: {
          client: { select: { id: true, name: true, email: true, phone: true, address: true } },
          opportunity: { select: { id: true, title: true } },
          items: { orderBy: { position: 'asc' } },
        },
      })
    })

    if (statusChanged && newStatus) {
      await auditAndTimeline({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'status_change',
        entity: 'quote',
        entityId: id,
        details: { number: existing.number, name: existing.number, from: existing.status, to: newStatus },
        clientId: updated.clientId,
        quoteId: id,
        timelineType: 'quote',
        timelineTitle: `Cotización ${existing.number} → ${QUOTE_STATUS_LABELS[newStatus] ?? newStatus}`,
      })
      await runWorkflowsForTrigger({
        orgId: auth.orgId,
        type: 'quote_status_changed',
        payload: { quoteId: id, clientId: updated.clientId, status: newStatus, number: existing.number, clientName: updated.client?.name },
      })

      // Aceptada → Transaction de ingreso automática
      if (newStatus === 'accepted' && existing.status !== 'accepted' && updated.total > 0) {
        const tx = await db.transaction.create({
          data: {
            organizationId: auth.orgId,
            type: 'ingreso',
            category: 'venta',
            description: `Cobro de cotización ${existing.number}`,
            amount: updated.total,
            currency: updated.currency,
            clientId: updated.clientId,
            quoteId: id,
            date: new Date(),
          },
        })
        await recordTimelineEvent({
          orgId: auth.orgId,
          clientId: updated.clientId,
          quoteId: id,
          type: 'transaction',
          title: `Ingreso registrado (${updated.currency} ${updated.total.toFixed(2)})`,
          description: `Cotización ${existing.number} aceptada`,
          source: 'system',
          userId: auth.userId,
          metadata: { transactionId: tx.id },
        })
      }
    } else {
      await auditAndTimeline({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'updated',
        entity: 'quote',
        entityId: id,
        details: { number: existing.number, fields: Object.keys(body).slice(0, 10) },
        clientId: updated.clientId,
        quoteId: id,
      })
    }

    const attrs = updated.client ? (await loadClientAttrs(auth.orgId, [updated.client.id])).get(updated.client.id) : undefined
    return json({ quote: serializeQuote(updated, { clientAttrs: attrs }) })
  })
}

/** DELETE /api/quotes/:id */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.quote.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, number: true } })
    if (!existing) throw new HttpError(404, 'Cotización no encontrada')

    await db.quote.delete({ where: { id } })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'deleted',
      entity: 'quote',
      entityId: id,
      details: { number: existing.number, name: existing.number },
    })
    return json({ success: true })
  })
}
