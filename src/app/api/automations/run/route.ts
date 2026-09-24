import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// POST /api/automations/run - Execute automations
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const results = {
      remindersSent: 0,
      inactiveRecovered: 0,
      loyaltyFollowUps: 0,
      errors: [] as string[],
    };

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1. Clients with upcoming reservations in next 24h → create reminder
    const upcomingReservations = await db.reservation.findMany({
      where: {
        userId: authResult.userId,
        date: { gte: now, lte: in24h },
        status: 'confirmed',
        reminderSent: false,
      },
      include: { client: true },
    });

    for (const reservation of upcomingReservations) {
      try {
        const reminderAutomation = await db.automation.findFirst({
          where: {
            userId: authResult.userId,
            type: 'reminder',
            isActive: true,
          },
        });

        if (reminderAutomation) {
          await db.automationLog.create({
            data: {
              automationId: reminderAutomation.id,
              clientId: reservation.clientId,
              status: 'sent',
              result: `Recordatorio para cita: ${reservation.title} el ${reservation.date.toLocaleDateString('es-ES')}`,
            },
          });

          await db.automation.update({
            where: { id: reminderAutomation.id },
            data: {
              lastRunAt: now,
              runCount: { increment: 1 },
            },
          });
        }

        await db.reservation.update({
          where: { id: reservation.id },
          data: { reminderSent: true },
        });

        results.remindersSent++;
      } catch (err) {
        results.errors.push(`Reminder error for reservation ${reservation.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    // 2. Clients inactive for 30+ days → flag for recovery
    const inactiveClients = await db.client.findMany({
      where: {
        userId: authResult.userId,
        isActive: true,
        lastContactAt: { lt: thirtyDaysAgo },
        temperature: { not: 'Frio' },
      },
      take: 50,
    });

    for (const client of inactiveClients) {
      try {
        const recoveryAutomation = await db.automation.findFirst({
          where: {
            userId: authResult.userId,
            type: 'inactive_recovery',
            isActive: true,
          },
        });

        if (recoveryAutomation) {
          const recentLog = await db.automationLog.findFirst({
            where: {
              automationId: recoveryAutomation.id,
              clientId: client.id,
              executedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
            },
          });

          if (!recentLog) {
            await db.automationLog.create({
              data: {
                automationId: recoveryAutomation.id,
                clientId: client.id,
                status: 'sent',
                result: `Cliente inactivo por 30+ días: ${client.name}. Último contacto: ${client.lastContactAt?.toLocaleDateString('es-ES') ?? 'N/A'}`,
              },
            });

            await db.client.update({
              where: { id: client.id },
              data: { temperature: 'Frio' },
            });

            results.inactiveRecovered++;
          }
        }
      } catch (err) {
        results.errors.push(`Recovery error for client ${client.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    // 3. Clients with recent service → suggest loyalty follow-up
    const recentServiceClients = await db.clientServiceHistory.findMany({
      where: {
        date: { gte: sevenDaysAgo, lte: now },
      },
      include: { client: true },
      take: 50,
    });

    for (const history of recentServiceClients) {
      if (history.client.userId !== authResult.userId) continue;

      try {
        const loyaltyAutomation = await db.automation.findFirst({
          where: {
            userId: authResult.userId,
            type: 'loyalty',
            isActive: true,
          },
        });

        if (loyaltyAutomation) {
          const recentLog = await db.automationLog.findFirst({
            where: {
              automationId: loyaltyAutomation.id,
              clientId: history.clientId,
              executedAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
            },
          });

          if (!recentLog) {
            await db.automationLog.create({
              data: {
                automationId: loyaltyAutomation.id,
                clientId: history.clientId,
                status: 'sent',
                result: `Seguimiento post-servicio para ${history.client.name}: ${history.serviceType}`,
              },
            });

            results.loyaltyFollowUps++;
          }
        }
      } catch (err) {
        results.errors.push(`Loyalty error for client ${history.clientId}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    await db.automation.updateMany({
      where: { userId: authResult.userId, isActive: true },
      data: { lastRunAt: now },
    });

    return NextResponse.json({
      message: 'Automatizaciones ejecutadas exitosamente',
      results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('Run automations error:', error);
    return NextResponse.json(
      { error: 'Error al ejecutar automatizaciones' },
      { status: 500 }
    );
  }
}
