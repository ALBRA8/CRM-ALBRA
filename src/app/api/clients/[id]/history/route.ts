import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/clients/[id]/history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, userId: authResult.userId },
  });

  if (!client) {
    return NextResponse.json(
      { error: 'Cliente no encontrado' },
      { status: 404 }
    );
  }

  const history = await db.clientServiceHistory.findMany({
    where: { clientId: id },
    orderBy: { date: 'desc' },
  });

  return NextResponse.json({ history });
}

// POST /api/clients/[id]/history - Add service history entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, userId: authResult.userId },
  });

  if (!client) {
    return NextResponse.json(
      { error: 'Cliente no encontrado' },
      { status: 404 }
    );
  }

  try {
    const body = await request.json();
    const { serviceType, description, amount, date, notes } = body;

    if (!serviceType || !description) {
      return NextResponse.json(
        { error: 'serviceType y description son requeridos' },
        { status: 400 }
      );
    }

    const entry = await db.clientServiceHistory.create({
      data: {
        clientId: id,
        serviceType,
        description,
        amount: amount ?? null,
        date: date ? new Date(date) : new Date(),
        notes,
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error('Add history error:', error);
    return NextResponse.json(
      { error: 'Error al agregar historial' },
      { status: 500 }
    );
  }
}
