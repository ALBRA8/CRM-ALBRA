import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// PUT /api/reservations/[id] - Update reservation
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { title, description, serviceType, date, duration, location, notes, status, reminderSent } = body;

    const existing = await db.reservation.findFirst({
      where: { id, userId: authResult.userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Reserva no encontrada' },
        { status: 404 }
      );
    }

    const reservation = await db.reservation.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(serviceType !== undefined && { serviceType }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(duration !== undefined && { duration }),
        ...(location !== undefined && { location }),
        ...(notes !== undefined && { notes }),
        ...(status !== undefined && { status }),
        ...(reminderSent !== undefined && { reminderSent }),
      },
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    return NextResponse.json({ reservation });
  } catch (error) {
    console.error('Update reservation error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar reserva' },
      { status: 500 }
    );
  }
}

// DELETE /api/reservations/[id] - Cancel reservation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const existing = await db.reservation.findFirst({
    where: { id, userId: authResult.userId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: 'Reserva no encontrada' },
      { status: 404 }
    );
  }

  const reservation = await db.reservation.update({
    where: { id },
    data: { status: 'cancelled' },
  });

  return NextResponse.json({ reservation, message: 'Reserva cancelada exitosamente' });
}
