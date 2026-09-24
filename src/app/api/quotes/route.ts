import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/quotes - List quotes
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '20');
  const status = searchParams.get('status') ?? '';
  const clientId = searchParams.get('clientId') ?? '';

  const where: Record<string, unknown> = {
    userId: authResult.userId,
  };

  if (status) where.status = status;
  if (clientId) where.clientId = clientId;

  const [quotes, total] = await Promise.all([
    db.quote.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, email: true, phone: true } },
        opportunity: { select: { id: true, title: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.quote.count({ where }),
  ]);

  return NextResponse.json({
    quotes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST /api/quotes - Create quote manually
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { clientId, opportunityId, items, discount, notes, validUntil } = body;

    if (!clientId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'clientId y items (array) son requeridos' },
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

    // Calculate totals
    const subtotal = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number }) =>
        sum + item.quantity * item.unitPrice,
      0
    );
    const discountAmount = subtotal * ((discount ?? 0) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxRate = 0.16;
    const taxAmount = afterDiscount * taxRate;
    const total = afterDiscount + taxAmount;

    // Generate quote number
    const year = new Date().getFullYear();
    const quoteCount = await db.quote.count({
      where: { userId: authResult.userId, quoteNumber: { startsWith: `COT-${year}-` } },
    });
    const quoteNumber = `COT-${year}-${String(quoteCount + 1).padStart(3, '0')}`;

    const quote = await db.quote.create({
      data: {
        userId: authResult.userId,
        clientId,
        opportunityId: opportunityId ?? null,
        quoteNumber,
        status: 'draft',
        subtotal,
        discount: discountAmount,
        tax: taxAmount,
        total,
        notes,
        validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Create quote items
    for (const item of items as Array<{ description: string; quantity: number; unitPrice: number; sku?: string }>) {
      await db.quoteItem.create({
        data: {
          quoteId: quote.id,
          sku: item.sku ?? null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.quantity * item.unitPrice,
        },
      });
    }

    const fullQuote = await db.quote.findUnique({
      where: { id: quote.id },
      include: { items: true, client: true },
    });

    return NextResponse.json({ quote: fullQuote }, { status: 201 });
  } catch (error) {
    console.error('Create quote error:', error);
    return NextResponse.json(
      { error: 'Error al crear cotización' },
      { status: 500 }
    );
  }
}
