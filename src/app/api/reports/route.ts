import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'reports', 'read')
  if (perm instanceof NextResponse) return perm
  const userId = perm.userId

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || '30d'

  const now = new Date()
  let startDate: Date
  switch (period) {
    case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break
    case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break
    case '1y': startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break
    case 'all': startDate = new Date(0); break
    default: startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break
  }

  try {
    // ==========================================
    // Pipeline Stages with count and value
    // ==========================================
    const stages = await db.pipelineStage.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
      include: {
        opportunities: {
          select: { estimatedValue: true },
        },
      },
    })

    const pipelineStages = stages.map(s => ({
      name: s.name,
      count: s.opportunities.length,
      value: s.opportunities.reduce((sum, o) => sum + o.estimatedValue, 0),
      color: s.color,
    }))

    const totalOpps = pipelineStages.reduce((a, s) => a + s.count, 0)

    // ==========================================
    // Revenue by Month (with expenses)
    // ==========================================
    const incomeTransactions = await db.transaction.findMany({
      where: { userId, type: 'ingreso', date: { gte: startDate } },
      orderBy: { date: 'asc' },
    })
    const expenseTransactions = await db.transaction.findMany({
      where: { userId, type: { in: ['egreso', 'compra_inventario'] }, date: { gte: startDate } },
      orderBy: { date: 'asc' },
    })

    const revenueByMonthMap: Record<string, { revenue: number; expenses: number }> = {}
    incomeTransactions.forEach(t => {
      const key = new Date(t.date).toISOString().slice(0, 7)
      if (!revenueByMonthMap[key]) revenueByMonthMap[key] = { revenue: 0, expenses: 0 }
      revenueByMonthMap[key].revenue += t.amount
    })
    expenseTransactions.forEach(t => {
      const key = new Date(t.date).toISOString().slice(0, 7)
      if (!revenueByMonthMap[key]) revenueByMonthMap[key] = { revenue: 0, expenses: 0 }
      revenueByMonthMap[key].expenses += t.amount
    })

    const revenueByMonth = Object.entries(revenueByMonthMap)
      .map(([month, data]) => ({ month, revenue: data.revenue, expenses: data.expenses }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // ==========================================
    // Sales by Source (with count and value)
    // ==========================================
    const clientsWithOpps = await db.client.findMany({
      where: { userId, createdAt: { gte: startDate } },
      include: {
        opportunities: {
          select: { estimatedValue: true },
        },
      },
    })

    const sourceMap: Record<string, { count: number; value: number }> = {}
    clientsWithOpps.forEach(c => {
      if (!sourceMap[c.source]) sourceMap[c.source] = { count: 0, value: 0 }
      sourceMap[c.source].count++
      sourceMap[c.source].value += c.opportunities.reduce((sum, o) => sum + o.estimatedValue, 0)
    })
    const salesBySource = Object.entries(sourceMap).map(([source, data]) => ({
      source,
      count: data.count,
      value: data.value,
    }))

    // ==========================================
    // Top Clients
    // ==========================================
    const clients = await db.client.findMany({
      where: { userId },
      include: {
        opportunities: { where: { closedAt: { gte: startDate } } },
        _count: { select: { opportunities: true, reservations: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const topClients = clients
      .map(c => ({
        id: c.id,
        name: c.name,
        totalValue: c.opportunities.reduce((a, o) => a + o.estimatedValue, 0),
        opportunityCount: c._count.opportunities,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10)

    // ==========================================
    // Conversion Rates
    // ==========================================
    const stageNames = stages.map(s => s.name)
    const prospeccionCount = pipelineStages.find(s => s.name === 'Prospección')?.count ?? 0
    const calificacionCount = pipelineStages.find(s => s.name === 'Calificación')?.count ?? 0
    const ofertaCount = pipelineStages.find(s => s.name === 'Oferta')?.count ?? 0
    const cierreGanadoCount = pipelineStages.find(s => s.name === 'Cierre Ganado')?.count ?? 0

    const leads = prospeccionCount + calificacionCount
    const qualified = calificacionCount + ofertaCount
    const proposed = ofertaCount
    const closed = cierreGanadoCount

    const conversionRates = {
      leads,
      qualified,
      proposed,
      closed,
      leadToQualified: leads > 0 ? Math.round((qualified / leads) * 100) : 0,
      qualifiedToProposed: qualified > 0 ? Math.round((proposed / qualified) * 100) : 0,
      proposedToClosed: proposed > 0 ? Math.round((closed / proposed) * 100) : 0,
      overallRate: totalOpps > 0 ? Math.round((cierreGanadoCount / totalOpps) * 100) : 0,
    }

    // ==========================================
    // Average Deal Duration
    // ==========================================
    const closedOpportunities = await db.opportunity.findMany({
      where: { userId, closedAt: { not: null, gte: startDate } },
      include: { stage: true },
    })
    let averageDealDays = 0
    if (closedOpportunities.length > 0) {
      const totalDays = closedOpportunities.reduce((a, o) => {
        const created = new Date(o.createdAt).getTime()
        const closed = new Date(o.closedAt!).getTime()
        return a + (closed - created) / (1000 * 60 * 60 * 24)
      }, 0)
      averageDealDays = Math.round(totalDays / closedOpportunities.length)
    }

    // ==========================================
    // Summary
    // ==========================================
    const totalRevenue = incomeTransactions.reduce((a, t) => a + t.amount, 0)
    const totalExpenses = expenseTransactions.reduce((a, t) => a + t.amount, 0)
    const newClients = await db.client.count({ where: { userId, createdAt: { gte: startDate } } })
    const newOpportunities = await db.opportunity.count({ where: { userId, createdAt: { gte: startDate } } })
    const wonOpportunities = closedOpportunities.filter(o => o.stage.name === 'Cierre Ganado').length

    return NextResponse.json({
      pipelineStages,
      revenueByMonth,
      salesBySource,
      topClients,
      conversionRates,
      averageDealDays,
      summary: {
        totalRevenue,
        totalExpenses,
        newClients,
        newOpportunities,
        wonOpportunities,
        totalOpps,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Error al generar reporte' }, { status: 500 })
  }
}
