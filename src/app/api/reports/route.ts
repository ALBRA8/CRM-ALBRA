import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * GET /api/reports?period=7d|30d|90d|1y|all — agregados del negocio.
 * (month|quarter|year se aceptan como alias de 30d|90d|1y).
 * Shape exacto consumido por reports-page.tsx.
 */

const PERIOD_DAYS: Record<string, number | null> = {
  '7d': 7,
  '30d': 30,
  month: 30,
  '90d': 90,
  quarter: 90,
  '1y': 365,
  year: 365,
  all: null,
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const rawPeriod = new URL(req.url).searchParams.get('period') || '30d'
    const days = rawPeriod in PERIOD_DAYS ? PERIOD_DAYS[rawPeriod] : 30
    const from = days ? new Date(Date.now() - days * 86_400_000) : new Date(0)
    const orgId = auth.orgId

    const [stages, transactions, opportunities, clients, quotes] = await Promise.all([
      db.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { order: 'asc' } }),
      db.transaction.findMany({ where: { organizationId: orgId, date: { gte: from } }, select: { type: true, amount: true, date: true } }),
      db.opportunity.findMany({
        where: { organizationId: orgId, createdAt: { gte: from } },
        select: { id: true, title: true, amount: true, status: true, source: true, clientId: true, stageId: true, createdAt: true, closedAt: true },
      }),
      db.client.findMany({
        where: { organizationId: orgId, createdAt: { gte: from } },
        select: { id: true, name: true, source: true },
      }),
      db.quote.findMany({ where: { organizationId: orgId, createdAt: { gte: from } }, select: { status: true } }),
    ])

    // Pipeline por etapa (sobre todas las oportunidades abiertas, no solo el período)
    const openOpps = await db.opportunity.findMany({
      where: { organizationId: orgId, status: 'open' },
      select: { stageId: true, amount: true },
    })
    const pipelineStages = stages.map((stage) => {
      const stageOpps = openOpps.filter((o) => o.stageId === stage.id)
      return {
        name: stage.name,
        count: stageOpps.length,
        value: stageOpps.reduce((acc, o) => acc + o.amount, 0),
        color: stage.color || '#059669',
      }
    })

    // Ingresos/egresos por mes
    const monthMap = new Map<string, { revenue: number; expenses: number }>()
    for (const t of transactions) {
      const key = monthKey(t.date)
      const entry = monthMap.get(key) || { revenue: 0, expenses: 0 }
      if (t.type === 'income') entry.revenue += t.amount
      else entry.expenses += t.amount
      monthMap.set(key, entry)
    }
    const revenueByMonth = [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, revenue: Math.round(v.revenue), expenses: Math.round(v.expenses) }))

    // Ventas por fuente (oportunidades + clientes)
    const sourceMap = new Map<string, { count: number; value: number }>()
    for (const o of opportunities) {
      const src = o.source || 'manual'
      const entry = sourceMap.get(src) || { count: 0, value: 0 }
      entry.count++
      entry.value += o.amount
      sourceMap.set(src, entry)
    }
    for (const c of clients) {
      const src = c.source || 'manual'
      const entry = sourceMap.get(src) || { count: 0, value: 0 }
      entry.count++
      sourceMap.set(src, entry)
    }
    const salesBySource = [...sourceMap.entries()].map(([source, v]) => ({ source, count: v.count, value: Math.round(v.value) }))

    // Top clientes por valor de oportunidades
    const clientMap = new Map<string, { totalValue: number; opportunityCount: number }>()
    for (const o of opportunities) {
      if (!o.clientId) continue
      const entry = clientMap.get(o.clientId) || { totalValue: 0, opportunityCount: 0 }
      entry.totalValue += o.amount
      entry.opportunityCount++
      clientMap.set(o.clientId, entry)
    }
    const clientIds = [...clientMap.keys()]
    const clientRows = clientIds.length
      ? await db.client.findMany({ where: { organizationId: orgId, id: { in: clientIds } }, select: { id: true, name: true } })
      : []
    const topClients = clientRows
      .map((c) => ({ id: c.id, name: c.name, totalValue: Math.round(clientMap.get(c.id)?.totalValue || 0), opportunityCount: clientMap.get(c.id)?.opportunityCount || 0 }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 5)

    // Conversión: leads (clientes) → calificados (oportunidades) → propuesta (quotes sent+) → cierre (won)
    const leads = clients.length
    const qualified = opportunities.length
    const proposed = quotes.filter((q) => ['sent', 'accepted', 'rejected', 'expired'].includes(q.status)).length
    const closed = opportunities.filter((o) => o.status === 'won').length
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
    const conversionRates = {
      leads,
      qualified,
      proposed,
      closed,
      leadToQualified: pct(qualified, leads),
      qualifiedToProposed: pct(proposed, qualified),
      proposedToClosed: pct(closed, proposed),
      overallRate: pct(closed, leads),
    }

    // Duración promedio de cierre (días entre creación y cierre de oportunidades ganadas)
    const wonWithDates = opportunities.filter((o) => o.status === 'won' && o.closedAt)
    const averageDealDays =
      wonWithDates.length > 0
        ? Math.round(wonWithDates.reduce((acc, o) => acc + (o.closedAt!.getTime() - o.createdAt.getTime()) / 86_400_000, 0) / wonWithDates.length)
        : 0

    const totalRevenue = transactions.filter((t) => t.type === 'income').reduce((acc, t) => acc + t.amount, 0)
    const totalExpenses = transactions.filter((t) => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0)

    return json({
      pipelineStages,
      revenueByMonth,
      salesBySource,
      topClients,
      conversionRates,
      averageDealDays,
      summary: {
        totalRevenue: Math.round(totalRevenue),
        totalExpenses: Math.round(totalExpenses),
        newClients: clients.length,
        newOpportunities: opportunities.length,
        wonOpportunities: closed,
        totalOpps: opportunities.length,
      },
      period: rawPeriod,
    })
  })
}
