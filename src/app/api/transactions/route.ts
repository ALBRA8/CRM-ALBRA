import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline, parseIntParam } from '@/lib/api-helpers'
import { handle, json, readBody, requireFields, str, dateOrNull, numOrNull, normalizeTxType, qparam } from '../_lib/shared'

/**
 * GET /api/transactions — filtros: type (ingreso|egreso|income|expense),
 * startDate, endDate, clientId. Devuelve { transactions, totals }.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const typeRaw = qparam(req, 'type')
    const type = typeRaw ? normalizeTxType(typeRaw) : null
    const startDate = qparam(req, 'startDate')
    const endDate = qparam(req, 'endDate')
    const clientId = qparam(req, 'clientId')
    const limit = parseIntParam(req, 'limit', 100, 1, 500)

    const where = {
      organizationId: auth.orgId,
      ...(type ? { type } : {}),
      ...(clientId ? { clientId } : {}),
      ...(startDate || endDate
        ? {
            date: {
              ...(startDate ? { gte: new Date(`${startDate}T00:00:00`) } : {}),
              ...(endDate ? { lt: new Date(new Date(`${endDate}T00:00:00`).getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
    }

    const [transactions, aggregate, incomeAgg, expenseAgg] = await Promise.all([
      db.transaction.findMany({ where, orderBy: { date: 'desc' }, take: limit }),
      db.transaction.aggregate({ where, _sum: { amount: true }, _count: true }),
      db.transaction.aggregate({ where: { ...where, type: 'ingreso' }, _sum: { amount: true } }),
      db.transaction.aggregate({ where: { ...where, type: 'egreso' }, _sum: { amount: true } }),
    ])

    return json({
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        category: t.category,
        description: t.description,
        referenceId: t.quoteId,
        method: t.method,
        date: t.date,
        createdAt: t.createdAt,
        clientId: t.clientId,
      })),
      totals: {
        sum: aggregate._sum.amount ?? 0,
        count: aggregate._count,
        income: incomeAgg._sum.amount ?? 0,
        expense: expenseAgg._sum.amount ?? 0,
      },
    })
  })
}

/** POST /api/transactions — { type, amount, category?, description, date?, clientId?, method? } */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['amount', 'description'])

    const amount = numOrNull(body.amount)
    if (amount === null || amount <= 0) throw new HttpError(400, 'El monto debe ser mayor a 0')

    const clientId = str(body.clientId)
    if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: auth.orgId }, select: { id: true, name: true } })
      if (!client) throw new HttpError(400, 'Cliente no encontrado')
    }

    const type = normalizeTxType(body.type)
    const created = await db.transaction.create({
      data: {
        organizationId: auth.orgId,
        type,
        category: str(body.category),
        description: str(body.description) as string,
        amount,
        currency: str(body.currency) ?? 'USD',
        date: dateOrNull(body.date) ?? new Date(),
        clientId: clientId || null,
        quoteId: str(body.quoteId),
        method: str(body.method),
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'transaction',
      entityId: created.id,
      details: { name: created.description, amount: created.amount, type: created.type },
      clientId: created.clientId,
      ...(clientId
        ? {
            timelineType: 'transaction' as const,
            timelineTitle: `${type === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado: ${created.description}`,
            timelineDescription: `${created.currency} ${created.amount.toFixed(2)}`,
          }
        : {}),
    })

    return json({ transaction: created }, { status: 201 })
  })
}
