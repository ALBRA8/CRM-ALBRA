import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json, monthKey, monthLabel } from '../_lib/shared'
import { loadClientAttrs } from '../_lib/clients'
import { parseOppMeta } from '../_lib/opportunities'
import { parseResMeta } from '../_lib/reservations'

/**
 * GET /api/dashboard — métricas con el shape exacto que consume
 * dashboard-page.tsx (campos en el nivel superior, más alias de contrato).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const orgId = auth.orgId
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const in7Days = new Date(now.getTime() + 7 * 86_400_000)

    const [
      statusCounts,
      opportunities,
      wonCount,
      monthlyRevenueAgg,
      recentTransactions,
      upcomingReservations,
      timelineEvents,
    ] = await Promise.all([
      db.client.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: true }),
      db.opportunity.findMany({
        where: { organizationId: orgId },
        include: {
          stage: true,
          client: { select: { id: true, name: true, email: true, phone: true, lastContactAt: true, createdAt: true } },
        },
      }),
      db.opportunity.count({ where: { organizationId: orgId, status: 'won' } }),
      db.transaction.aggregate({
        where: { organizationId: orgId, type: 'ingreso', date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      db.transaction.findMany({
        where: { organizationId: orgId, type: 'ingreso', date: { gte: sixMonthsAgo } },
        select: { date: true, amount: true },
      }),
      db.reservation.findMany({
        where: { organizationId: orgId, startsAt: { gte: now, lte: in7Days }, status: { not: 'cancelled' } },
        orderBy: { startsAt: 'asc' },
        take: 8,
        include: { client: { select: { id: true, name: true } } },
      }),
      db.timelineEvent.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

    // ---- Clientes por estado
    const countByStatus = new Map(statusCounts.map((s) => [s.status, s._count]))
    const totalClients = statusCounts.reduce((s, x) => s + x._count, 0)
    const activeClients = countByStatus.get('active') ?? 0
    const prospects = countByStatus.get('prospect') ?? 0
    const inactiveClients = countByStatus.get('inactive') ?? 0

    // ---- Pipeline por etapa (solo oportunidades abiertas)
    const stages = await db.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { order: 'asc' } })
    const openOpps = opportunities.filter((o) => o.status === 'open')
    const pipelineValue = openOpps.reduce((s, o) => s + o.amount, 0)
    const opportunitiesByStage = stages.map((stage) => {
      const inStage = openOpps.filter((o) => o.stageId === stage.id)
      return {
        id: stage.id,
        name: stage.name,
        order: stage.order,
        color: stage.color,
        count: inStage.length,
        value: inStage.reduce((s, o) => s + o.amount, 0),
      }
    })

    // ---- Tendencia de ingresos (6 meses)
    const trendMap = new Map<string, { label: string; revenue: number; sort: Date }>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      trendMap.set(monthKey(d), { label: monthLabel(d), revenue: 0, sort: d })
    }
    for (const tx of recentTransactions) {
      const entry = trendMap.get(monthKey(tx.date))
      if (entry) entry.revenue += tx.amount
    }
    const monthlyTrend = Array.from(trendMap.values())
      .sort((a, b) => a.sort.getTime() - b.sort.getTime())
      .map((t) => ({ month: t.label, revenue: Math.round(t.revenue) }))

    // ---- Tasa de conversión
    const conversionRate = opportunities.length > 0 ? Math.round((wonCount / opportunities.length) * 100) : 0

    // ---- Reservas próximas (7 días)
    const upcoming = upcomingReservations.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.startsAt,
      duration: r.endsAt ? Math.max(15, Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60_000)) : 60,
      status: r.status,
      serviceType: parseResMeta(r.description).serviceType,
      client: r.client ? { id: r.client.id, name: r.client.name } : undefined,
    }))

    // ---- Clientes/oportunidades para seguimiento
    const attrsMap = await loadClientAttrs(
      orgId,
      opportunities.map((o) => o.client?.id).filter((x): x is string => Boolean(x))
    )
    const clientsNeedingFollowUp = openOpps
      .filter((o) => o.client)
      .map((o) => {
        const meta = parseOppMeta(o.notes)
        const attrs = o.client ? attrsMap.get(o.client.id) : undefined
        return {
          id: o.id,
          title: o.title,
          nextAction: meta.nextAction,
          nextActionDate: meta.nextActionDate,
          client: {
            id: o.client?.id ?? '',
            name: o.client?.name ?? 'Sin cliente',
            temperature: attrs?.temperature || 'Frio',
          },
          stage: { name: o.stage?.name ?? 'Sin etapa' },
        }
      })
      .sort((a, b) => {
        const da = a.nextActionDate ? new Date(a.nextActionDate).getTime() : Number.MAX_SAFE_INTEGER
        const db2 = b.nextActionDate ? new Date(b.nextActionDate).getTime() : Number.MAX_SAFE_INTEGER
        return da - db2
      })
      .slice(0, 6)

    // ---- Actividad reciente (timeline unificado)
    const tlClientIds = Array.from(new Set(timelineEvents.map((e) => e.clientId).filter(Boolean))) as string[]
    const tlClients = tlClientIds.length
      ? await db.client.findMany({ where: { id: { in: tlClientIds } }, select: { id: true, name: true } })
      : []
    const tlClientMap = new Map(tlClients.map((c) => [c.id, c.name]))

    const recentActivity = timelineEvents.map((e) => ({
      id: e.id,
      role: e.source === 'manual' ? 'user' : 'agent',
      content: e.description ? `${e.title} — ${e.description}` : e.title,
      createdAt: e.createdAt,
      client: e.clientId ? { id: e.clientId, name: tlClientMap.get(e.clientId) ?? 'Cliente' } : undefined,
    }))

    const stats = {
      totalClients,
      activeClients,
      prospects,
      inactiveClients,
      monthlyRevenue: monthlyRevenueAgg._sum.amount ?? 0,
      pipelineValue,
      conversionRate,
      totalOpportunities: opportunities.length,
      openOpportunities: openOpps.length,
      wonOpportunities: wonCount,
    }

    return json({
      // Shape plano consumido por dashboard-page.tsx
      ...stats,
      opportunitiesByStage,
      monthlyTrend,
      upcomingReservations: upcoming,
      clientsNeedingFollowUp,
      recentActivity,
      // Alias del contrato documentado
      stats,
      pipeline: opportunitiesByStage,
      revenue: monthlyTrend,
      clientsToContact: clientsNeedingFollowUp,
    })
  })
}
