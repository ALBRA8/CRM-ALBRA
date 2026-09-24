import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/suggestions - Smart contact suggestions
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const now = new Date();

    // Get all active clients with their latest opportunity
    const clients = await db.client.findMany({
      where: {
        userId: authResult.userId,
        isActive: true,
      },
      include: {
        opportunities: {
          include: { stage: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        reservations: {
          where: {
            date: { gte: now },
            status: 'confirmed',
          },
          orderBy: { date: 'asc' },
          take: 1,
        },
      },
    });

    // Calculate contact priority score for each client
    const scoredClients = clients.map((client) => {
      let score = 0;
      const reasons: string[] = [];

      // Days since last contact (more days = higher priority, max 30 points)
      const daysSinceContact = client.lastContactAt
        ? Math.floor((now.getTime() - new Date(client.lastContactAt).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const contactScore = Math.min(30, daysSinceContact);
      score += contactScore;

      if (daysSinceContact >= 30) {
        reasons.push('Inactivo por más de 30 días');
      } else if (daysSinceContact >= 14) {
        reasons.push('Sin contacto por 2+ semanas');
      } else if (daysSinceContact >= 7) {
        reasons.push('Sin contacto esta semana');
      }

      // Pipeline stage weight
      const latestOpp = client.opportunities[0];
      if (latestOpp) {
        const stageName = latestOpp.stage.name;
        const stageWeights: Record<string, number> = {
          Prospección: 10,
          Calificación: 15,
          Oferta: 30,
          Seguimiento: 25,
          'Cierre Ganado': 5,
          'Cierre Perdido': 2,
        };
        const stageScore = stageWeights[stageName] ?? 5;
        score += stageScore;

        if (stageName === 'Oferta') {
          reasons.push('En etapa de Oferta - listo para cerrar');
        } else if (stageName === 'Seguimiento') {
          reasons.push('En seguimiento - necesita atención');
        } else if (stageName === 'Calificación') {
          reasons.push('En calificación - avanzar proceso');
        }

        // Has upcoming nextActionDate = bonus
        if (latestOpp.nextActionDate && new Date(latestOpp.nextActionDate) <= now) {
          score += 20;
          reasons.push('Tiene acción pendiente vencida');
        }
      }

      // Temperature weight
      const temperatureWeights: Record<string, number> = {
        Fuego: 20,
        Caliente: 15,
        Tibio: 8,
        Frio: 3,
      };
      const tempScore = temperatureWeights[client.temperature] ?? 3;
      score += tempScore;

      if (client.temperature === 'Fuego') {
        reasons.push('Cliente Fuego - máxima prioridad');
      } else if (client.temperature === 'Caliente') {
        reasons.push('Cliente Caliente - alta probabilidad');
      }

      // Has upcoming reservation = bonus
      if (client.reservations.length > 0) {
        score += 10;
        const resDate = new Date(client.reservations[0].date);
        const daysUntil = Math.ceil((resDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= 1) {
          reasons.push(`Cita mañana: ${client.reservations[0].title}`);
        } else {
          reasons.push(`Cita en ${daysUntil} días: ${client.reservations[0].title}`);
        }
      }

      // Lead score bonus
      if (client.score >= 80) {
        score += 10;
        reasons.push(`Lead score alto: ${client.score}`);
      }

      return {
        client: {
          id: client.id,
          name: client.name,
          phone: client.phone,
          email: client.email,
          temperature: client.temperature,
          score: client.score,
          lastContactAt: client.lastContactAt,
          daysSinceContact,
          latestOpportunity: latestOpp
            ? {
                id: latestOpp.id,
                title: latestOpp.title,
                stage: latestOpp.stage.name,
                estimatedValue: latestOpp.estimatedValue,
              }
            : null,
          upcomingReservation: client.reservations[0]
            ? {
                id: client.reservations[0].id,
                title: client.reservations[0].title,
                date: client.reservations[0].date,
              }
            : null,
        },
        priorityScore: score,
        reasons: reasons.length > 0 ? reasons : ['Contacto general'],
      };
    });

    // Sort by score descending and take top 10
    const topSuggestions = scoredClients
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 10);

    return NextResponse.json({
      suggestions: topSuggestions,
      totalClients: clients.length,
    });
  } catch (error) {
    console.error('Suggestions error:', error);
    return NextResponse.json(
      { error: 'Error al generar sugerencias' },
      { status: 500 }
    );
  }
}
