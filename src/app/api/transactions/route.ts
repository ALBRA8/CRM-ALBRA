import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkPermission } from '@/lib/permissions';

// GET /api/transactions - List transactions with filters
export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'transactions', 'read');
  if (perm instanceof NextResponse) return perm;
  const authResult = { userId: perm.userId };

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '20');
  const type = searchParams.get('type') ?? '';
  const category = searchParams.get('category') ?? '';
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';

  const where: Record<string, unknown> = {
    userId: authResult.userId,
  };

  if (type) where.type = type;
  if (category) where.category = category;
  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.date = dateFilter;
  }

  const [transactions, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.transaction.count({ where }),
  ]);

  // Get totals
  const totals = await db.transaction.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  });

  return NextResponse.json({
    transactions,
    totals: {
      sum: totals._sum.amount ?? 0,
      count: totals._count,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST /api/transactions - Create transaction
export async function POST(request: NextRequest) {
  const perm = await checkPermission(request, 'transactions', 'create');
  if (perm instanceof NextResponse) return perm;
  const authResult = { userId: perm.userId };

  try {
    const body = await request.json();
    const { type, amount, category, description, referenceId, date } = body;

    if (!type || !amount || !description) {
      return NextResponse.json(
        { error: 'type, amount y description son requeridos' },
        { status: 400 }
      );
    }

    const transaction = await db.transaction.create({
      data: {
        userId: authResult.userId,
        type,
        amount,
        category,
        description,
        referenceId,
        date: date ? new Date(date) : new Date(),
      },
    });

    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) {
    console.error('Create transaction error:', error);
    return NextResponse.json(
      { error: 'Error al crear transacción' },
      { status: 500 }
    );
  }
}
