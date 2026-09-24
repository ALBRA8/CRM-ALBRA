import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline, parseIntParam } from '@/lib/api-helpers'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { handle, json, readBody, requireFields, str, dateOrNull, numOrNull, clamp, qparam } from '../_lib/shared'
import { loadClientAttrs } from '../_lib/clients'
import { computeQuoteTotals, itemsFromBody, nextQuoteNumber, quoteItemRows, serializeQuote } from '../_lib/quotes'

/** GET /api/quotes — filtros: status, clientId. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const status = qparam(req, 'status')
    const clientId = qparam(req, 'clientId')
    const limit = parseIntParam(req, 'limit', 100, 1, 500)

    const quotes = await db.quote.findMany({
      where: {
        organizationId: auth.orgId,
        ...(status ? { status } : {}),
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        client: { select: { id: true, name: true, email: true, phone: true, address: true } },
        opportunity: { select: { id: true, title: true } },
        items: true,
      },
    })

    const attrsMap = await loadClientAttrs(auth.orgId, quotes.map((q) => q.client?.id).filter((x): x is string => Boolean(x)))
    return json({
      quotes: quotes.map((q) => serializeQuote(q, { clientAttrs: q.client ? attrsMap.get(q.client.id) : undefined })),
    })
  })
}

/** POST /api/quotes — { clientId, opportunityId?, items[], discount%, notes?, validUntil? } */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['clientId'])

    const clientId = str(body.clientId) as string
    const client = await db.client.findFirst({ where: { id: clientId, organizationId: auth.orgId }, select: { id: true, name: true } })
    if (!client) throw new HttpError(400, 'Cliente no encontrado')

    const items = itemsFromBody(body)
    if (!items || items.length === 0) throw new HttpError(400, 'La cotización debe tener al menos un item')

    const opportunityId = str(body.opportunityId)
    if (opportunityId) {
      const opp = await db.opportunity.findFirst({ where: { id: opportunityId, organizationId: auth.orgId }, select: { id: true } })
      if (!opp) throw new HttpError(400, 'Oportunidad no encontrada')
    }

    const discountPct = clamp(numOrNull(body.discount) ?? 0, 0, 100)
    const totals = computeQuoteTotals(items, discountPct)
    const number = await nextQuoteNumber(auth.orgId)

    const created = await db.quote.create({
      data: {
        organizationId: auth.orgId,
        number,
        clientId,
        opportunityId: opportunityId || null,
        items: { create: quoteItemRows(items) },
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        currency: str(body.currency) ?? 'USD',
        status: str(body.status) ?? 'draft',
        validUntil: dateOrNull(body.validUntil),
        notes: str(body.notes),
      },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true, address: true } },
        opportunity: { select: { id: true, title: true } },
        items: true,
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'quote',
      entityId: created.id,
      details: { number, name: number, total: created.total },
      clientId,
      quoteId: created.id,
      timelineType: 'quote',
      timelineTitle: `Cotización ${number} creada`,
      timelineDescription: `${client.name} — Total: ${created.currency} ${created.total.toFixed(2)}`,
    })

    return json({ quote: serializeQuote(created) }, { status: 201 })
  })
}
