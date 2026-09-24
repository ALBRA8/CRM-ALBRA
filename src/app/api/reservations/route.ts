import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/reservations - List reservations
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '20');
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';
  const status = searchParams.get('status') ?? '';
  const clientId = searchParams.get('clientId') ?? '';

  const where: Record<string, unknown> = {
    userId: authResult.userId,
  };

  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.date = dateFilter;
  }

  if (status) where.status = status;
  if (clientId) where.clientId = clientId;

  const [reservations, total] = await Promise.all([
    db.reservation.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { date: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.reservation.count({ where }),
  ]);

  return NextResponse.json({
    reservations,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST /api/reservations - Create reservation
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { clientId, title, description, serviceType, date, duration, location, notes } = body;

    if (!title || !date) {
      return NextResponse.json(
        { error: 'title y date son requeridos' },
        { status: 400 }
      );
    }

    // Verify client belongs to user if provided
    if (clientId) {
      const client = await db.client.findFirst({
        where: { id: clientId, userId: authResult.userId },
      });
      if (!client) {
        return NextResponse.json(
          { error: 'Cliente no encontrado' },
          { status: 404 }
        );
      }
    }

    const reservation = await db.reservation.create({
      data: {
        userId: authResult.userId,
        clientId: clientId ?? null,
        title,
        description,
        serviceType,
        date: new Date(date),
        duration: duration ?? 60,
        location,
        notes,
        status: 'confirmed',
      },
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    console.error('Create reservation error:', error);
    return NextResponse.json(
      { error: 'Error al crear reserva' },
      { status: 500 }
    );
  }
}
