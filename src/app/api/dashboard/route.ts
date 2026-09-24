import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/dashboard - Dashboard stats
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Total active clients
    const totalClients = await db.client.count({
      where: { userId: authResult.userId, isActive: true },
    });

    // Opportunities by stage
    const stages = await db.pipelineStage.findMany({
      where: { userId: authResult.userId },
      include: {
        _count: { select: { opportunities: true } },
        opportunities: {
          select: { estimatedValue: true },
        },
      },
      orderBy: { order: 'asc' },
    });

    const opportunitiesByStage = stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      count: stage._count.opportunities,
      value: stage.opportunities.reduce((sum, o) => sum + o.estimatedValue, 0),
    }));

    // Pipeline value (sum of estimated values of open opportunities)
    const pipelineValue = await db.opportunity.aggregate({
      where: {
        userId: authResult.userId,
        closedAt: null,
      },
      _sum: { estimatedValue: true },
    });

    // Revenue this month (from transactions)
    const monthlyRevenue = await db.transaction.aggregate({
      where: {
        userId: authResult.userId,
        type: 'ingreso',
        date: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });

    // Upcoming reservations (next 7 days)
    const upcomingReservations = await db.reservation.findMany({
      where: {
        userId: authResult.userId,
        date: { gte: now, lte: sevenDaysFromNow },
        status: 'confirmed',
      },
      include: {
        client: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { date: 'asc' },
      take: 10,
    });

    // Clients needing follow-up (nextActionDate <= today)
    const clientsNeedingFollowUp = await db.opportunity.findMany({
      where: {
        userId: authResult.userId,
        nextActionDate: { lte: now },
        closedAt: null,
      },
      include: {
        client: { select: { id: true, name: true, phone: true, temperature: true } },
        stage: true,
      },
      take: 10,
    });

    // Inactive clients (no contact in 30+ days)
    const inactiveClients = await db.client.count({
      where: {
        userId: authResult.userId,
        isActive: true,
        lastContactAt: { lt: thirtyDaysAgo },
      },
    });

    // Recent activity (last 10 chat logs)
    const recentActivity = await db.chatLog.findMany({
      where: { userId: authResult.userId },
      include: {
        client: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Monthly revenue trend (last 6 months)
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

      const revenue = await db.transaction.aggregate({
        where: {
          userId: authResult.userId,
          type: 'ingreso',
          date: { gte: monthStart, lte: monthEnd },
        },
        _sum: { amount: true },
      });

      monthlyTrend.push({
        month: monthStart.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }),
        revenue: revenue._sum.amount ?? 0,
      });
    }

    // Conversion rate
    const totalClosed = await db.opportunity.count({
      where: { userId: authResult.userId, closedAt: { not: null } },
    });
    const closedWon = await db.opportunity.count({
      where: {
        userId: authResult.userId,
        stage: { name: 'Cierre Ganado' },
        closedAt: { not: null },
      },
    });
    const conversionRate = totalClosed > 0 ? Math.round((closedWon / totalClosed) * 100) : 0;

    return NextResponse.json({
      totalClients,
      opportunitiesByStage,
      pipelineValue: pipelineValue._sum.estimatedValue ?? 0,
      monthlyRevenue: monthlyRevenue._sum.amount ?? 0,
      upcomingReservations,
      clientsNeedingFollowUp,
      inactiveClients,
      recentActivity,
      monthlyTrend,
      conversionRate,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json(
      { error: 'Error al obtener datos del dashboard' },
      { status: 500 }
    );
  }
}
