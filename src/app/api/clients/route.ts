import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { checkPermission } from '@/lib/permissions';

// GET /api/clients - List clients with pagination, search, filters
export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'clients', 'read');
  if (perm instanceof NextResponse) return perm;
  const authResult = { userId: perm.userId };

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '20');
  const search = searchParams.get('search') ?? '';
  const temperature = searchParams.get('temperature') ?? '';
  const source = searchParams.get('source') ?? '';
  const sortBy = searchParams.get('sortBy') ?? 'createdAt';
  const sortOrder = searchParams.get('sortOrder') ?? 'desc';

  const where: Record<string, unknown> = {
    userId: authResult.userId,
    isActive: true,
  };

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
      { phone: { contains: search } },
      { company: { contains: search } },
    ];
  }

  if (temperature) {
    where.temperature = temperature;
  }

  if (source) {
    where.source = source;
  }

  const [clients, total] = await Promise.all([
    db.client.findMany({
      where,
      include: {
        opportunities: {
          include: { stage: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { opportunities: true, reservations: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.client.count({ where }),
  ]);

  return NextResponse.json({
    clients,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST /api/clients - Create client manually
export async function POST(request: NextRequest) {
  const perm = await checkPermission(request, 'clients', 'create');
  if (perm instanceof NextResponse) return perm;
  const authResult = { userId: perm.userId };

  try {
    const body = await request.json();
    const { name, email, phone, identifier, company, address, city, notes, source, tags, temperature } = body;

    if (!name || !phone) {
      return NextResponse.json(
        { error: 'Nombre y teléfono son requeridos' },
        { status: 400 }
      );
    }

    const client = await db.client.create({
      data: {
        userId: authResult.userId,
        name,
        email,
        phone,
        identifier,
        company,
        address,
        city,
        notes,
        source: source ?? 'manual',
        tags: tags ? JSON.stringify(tags) : null,
        temperature: temperature ?? 'Frio',
        score: 0,
        lastContactAt: new Date(),
      },
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    console.error('Create client error:', error);
    return NextResponse.json(
      { error: 'Error al crear cliente' },
      { status: 500 }
    );
  }
}
