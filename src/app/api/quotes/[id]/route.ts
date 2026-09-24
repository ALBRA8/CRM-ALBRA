import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/quotes/[id] - Quote detail with items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const quote = await db.quote.findFirst({
    where: { id, userId: authResult.userId },
    include: {
      client: true,
      opportunity: true,
      items: true,
    },
  });

  if (!quote) {
    return NextResponse.json(
      { error: 'Cotización no encontrada' },
      { status: 404 }
    );
  }

  return NextResponse.json({ quote });
}

// PUT /api/quotes/[id] - Update quote status
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { status, notes } = body;

    const existing = await db.quote.findFirst({
      where: { id, userId: authResult.userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      );
    }

    const quote = await db.quote.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        client: true,
        items: true,
      },
    });

    return NextResponse.json({ quote });
  } catch (error) {
    console.error('Update quote error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar cotización' },
      { status: 500 }
    );
  }
}
