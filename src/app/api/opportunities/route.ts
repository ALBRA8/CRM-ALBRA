import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/opportunities - List opportunities
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '20');
  const stageId = searchParams.get('stageId') ?? '';
  const clientId = searchParams.get('clientId') ?? '';
  const search = searchParams.get('search') ?? '';

  const where: Record<string, unknown> = {
    userId: authResult.userId,
  };

  if (stageId) where.stageId = stageId;
  if (clientId) where.clientId = clientId;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { interest: { contains: search } },
      { client: { name: { contains: search } } },
    ];
  }

  const [opportunities, total] = await Promise.all([
    db.opportunity.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, email: true, phone: true, temperature: true } },
        stage: true,
        progressNotes: { orderBy: { createdAt: 'desc' }, take: 3 },
        _count: { select: { quotes: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.opportunity.count({ where }),
  ]);

  return NextResponse.json({
    opportunities,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST /api/opportunities - Create opportunity
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { clientId, stageId, title, interest, estimatedValue, probability, notes, nextAction, nextActionDate } = body;

    if (!clientId || !title) {
      return NextResponse.json(
        { error: 'clientId y title son requeridos' },
        { status: 400 }
      );
    }

    // Verify client belongs to user
    const client = await db.client.findFirst({
      where: { id: clientId, userId: authResult.userId },
    });

    if (!client) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      );
    }

    // Find default stage if not provided
    let targetStageId = stageId;
    if (!targetStageId) {
      const firstStage = await db.pipelineStage.findFirst({
        where: { userId: authResult.userId },
        orderBy: { order: 'asc' },
      });
      targetStageId = firstStage?.id;
    }

    if (!targetStageId) {
      return NextResponse.json(
        { error: 'No hay etapas de pipeline configuradas' },
        { status: 400 }
      );
    }

    const opportunity = await db.opportunity.create({
      data: {
        userId: authResult.userId,
        clientId,
        stageId: targetStageId,
        title,
        interest: interest ?? '',
        estimatedValue: estimatedValue ?? 0,
        probability: probability ?? 20,
        notes,
        nextAction,
        nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
      },
      include: {
        client: true,
        stage: true,
      },
    });

    // Create progress note
    await db.progressNote.create({
      data: {
        opportunityId: opportunity.id,
        stageName: opportunity.stage.name,
        note: `Oportunidad creada: ${title}`,
      },
    });

    return NextResponse.json({ opportunity }, { status: 201 });
  } catch (error) {
    console.error('Create opportunity error:', error);
    return NextResponse.json(
      { error: 'Error al crear oportunidad' },
      { status: 500 }
    );
  }
}
