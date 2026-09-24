import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/clients/[id]/preferences
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

  const preferences = await db.clientPreference.findMany({
    where: { clientId: id },
    orderBy: { category: 'asc' },
  });

  return NextResponse.json({ preferences });
}

// PUT /api/clients/[id]/preferences - Upsert preferences
export async function PUT(
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
    const { preferences } = body as { preferences: Array<{ category: string; key: string; value: string }> };

    if (!Array.isArray(preferences)) {
      return NextResponse.json(
        { error: 'preferences debe ser un array' },
        { status: 400 }
      );
    }

    const results = [];
    for (const pref of preferences) {
      const result = await db.clientPreference.upsert({
        where: {
          clientId_category_key: {
            clientId: id,
            category: pref.category,
            key: pref.key,
          },
        },
        create: {
          clientId: id,
          category: pref.category,
          key: pref.key,
          value: pref.value,
        },
        update: {
          value: pref.value,
        },
      });
      results.push(result);
    }

    return NextResponse.json({ preferences: results });
  } catch (error) {
    console.error('Update preferences error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar preferencias' },
      { status: 500 }
    );
  }
}
