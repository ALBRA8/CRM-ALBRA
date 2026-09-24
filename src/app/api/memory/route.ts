import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/memory - List memory entries
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') ?? '';

  const where: Record<string, unknown> = {
    userId: authResult.userId,
    isActive: true,
  };

  if (category) where.category = category;

  const memories = await db.memory.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({ memories });
}

// POST /api/memory - Add memory entry
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { category, key, value, source } = body;

    if (!category || !key || !value) {
      return NextResponse.json(
        { error: 'category, key y value son requeridos' },
        { status: 400 }
      );
    }

    const memory = await db.memory.upsert({
      where: {
        userId_category_key: {
          userId: authResult.userId,
          category,
          key,
        },
      },
      create: {
        userId: authResult.userId,
        category,
        key,
        value,
        source: source ?? 'user',
      },
      update: {
        value,
        source: source ?? 'user',
      },
    });

    return NextResponse.json({ memory }, { status: 201 });
  } catch (error) {
    console.error('Create memory error:', error);
    return NextResponse.json(
      { error: 'Error al crear entrada de memoria' },
      { status: 500 }
    );
  }
}
