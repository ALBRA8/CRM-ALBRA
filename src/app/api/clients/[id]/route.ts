import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { checkPermission } from '@/lib/permissions';

// GET /api/clients/[id] - Client detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, userId: authResult.userId },
    include: {
      preferences: true,
      serviceHistory: { orderBy: { date: 'desc' } },
      opportunities: {
        include: { stage: true, progressNotes: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      },
      reservations: {
        orderBy: { date: 'desc' },
        take: 10,
      },
      quotes: {
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      chatLogs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!client) {
    return NextResponse.json(
      { error: 'Cliente no encontrado' },
      { status: 404 }
    );
  }

  return NextResponse.json({ client });
}

// PUT /api/clients/[id] - Update client
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, email, phone, identifier, company, address, city, notes, source, tags, temperature, score } = body;

    const existing = await db.client.findFirst({
      where: { id, userId: authResult.userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      );
    }

    const client = await db.client.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(identifier !== undefined && { identifier }),
        ...(company !== undefined && { company }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(notes !== undefined && { notes }),
        ...(source !== undefined && { source }),
        ...(tags !== undefined && { tags: JSON.stringify(tags) }),
        ...(temperature !== undefined && { temperature }),
        ...(score !== undefined && { score }),
      },
    });

    return NextResponse.json({ client });
  } catch (error) {
    console.error('Update client error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar cliente' },
      { status: 500 }
    );
  }
}

// DELETE /api/clients/[id] - Soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const perm = await checkPermission(request, 'clients', 'delete');
  if (perm instanceof NextResponse) return perm;
  const authResult = { userId: perm.userId };

  const { id } = await params;

  const existing = await db.client.findFirst({
    where: { id, userId: authResult.userId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: 'Cliente no encontrado' },
      { status: 404 }
    );
  }

  await db.client.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ message: 'Cliente desactivado exitosamente' });
}
