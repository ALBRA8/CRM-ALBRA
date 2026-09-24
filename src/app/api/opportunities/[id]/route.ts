import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/opportunities/[id] - Opportunity detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const opportunity = await db.opportunity.findFirst({
    where: { id, userId: authResult.userId },
    include: {
      client: true,
      stage: true,
      progressNotes: { orderBy: { createdAt: 'desc' } },
      quotes: { include: { items: true }, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!opportunity) {
    return NextResponse.json(
      { error: 'Oportunidad no encontrada' },
      { status: 404 }
    );
  }

  return NextResponse.json({ opportunity });
}

// PUT /api/opportunities/[id] - Update opportunity
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { stageId, title, interest, estimatedValue, actualValue, probability, notes, nextAction, nextActionDate, closedAt } = body;

    const existing = await db.opportunity.findFirst({
      where: { id, userId: authResult.userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Oportunidad no encontrada' },
        { status: 404 }
      );
    }

    // If changing stage, create progress note
    if (stageId && stageId !== existing.stageId) {
      const newStage = await db.pipelineStage.findFirst({
        where: { id: stageId, userId: authResult.userId },
      });

      if (newStage) {
        const currentStage = await db.pipelineStage.findFirst({
          where: { id: existing.stageId },
        });

        await db.progressNote.create({
          data: {
            opportunityId: id,
            stageName: newStage.name,
            note: `Etapa cambiada de "${currentStage?.name ?? 'Desconocida'}" a "${newStage.name}"`,
          },
        });
      }
    }

    // If closing, create transaction for Cierre Ganado
    if (closedAt && body.stageId) {
      const newStage = await db.pipelineStage.findFirst({
        where: { id: body.stageId },
      });

      if (newStage?.name === 'Cierre Ganado') {
        const value = actualValue ?? estimatedValue ?? 0;
        if (value > 0) {
          await db.transaction.create({
            data: {
              userId: authResult.userId,
              type: 'ingreso',
              amount: value,
              category: 'venta',
              description: `Cierre de oportunidad: ${title ?? existing.title}`,
              referenceId: id,
              date: new Date(),
            },
          });
        }
      }
    }

    const opportunity = await db.opportunity.update({
      where: { id },
      data: {
        ...(stageId !== undefined && { stageId }),
        ...(title !== undefined && { title }),
        ...(interest !== undefined && { interest }),
        ...(estimatedValue !== undefined && { estimatedValue }),
        ...(actualValue !== undefined && { actualValue }),
        ...(probability !== undefined && { probability }),
        ...(notes !== undefined && { notes }),
        ...(nextAction !== undefined && { nextAction }),
        ...(nextActionDate !== undefined && { nextActionDate: nextActionDate ? new Date(nextActionDate) : null }),
        ...(closedAt !== undefined && { closedAt: closedAt ? new Date(closedAt) : null }),
      },
      include: {
        client: true,
        stage: true,
        progressNotes: { orderBy: { createdAt: 'desc' } },
      },
    });

    return NextResponse.json({ opportunity });
  } catch (error) {
    console.error('Update opportunity error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar oportunidad' },
      { status: 500 }
    );
  }
}
