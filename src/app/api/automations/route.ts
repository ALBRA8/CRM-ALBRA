import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkPermission } from '@/lib/permissions';

// GET /api/automations - List automations
export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'automations', 'read');
  if (perm instanceof NextResponse) return perm;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? '';

  const where: Record<string, unknown> = {
    userId: perm.userId,
  };

  if (type) where.type = type;

  const automations = await db.automation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ automations });
}

// POST /api/automations - Create automation
export async function POST(request: NextRequest) {
  const perm = await checkPermission(request, 'automations', 'create');
  if (perm instanceof NextResponse) return perm;

  try {
    const body = await request.json();
    const { name, type, trigger, conditions, actions, message, isActive } = body;

    if (!name || !type || !trigger || !actions) {
      return NextResponse.json(
        { error: 'name, type, trigger y actions son requeridos' },
        { status: 400 }
      );
    }

    const automation = await db.automation.create({
      data: {
        userId: perm.userId,
        name,
        type,
        trigger,
        conditions: conditions ? JSON.stringify(conditions) : null,
        actions: typeof actions === 'string' ? actions : JSON.stringify(actions),
        message,
        isActive: isActive ?? true,
      },
    });

    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    console.error('Create automation error:', error);
    return NextResponse.json(
      { error: 'Error al crear automatización' },
      { status: 500 }
    );
  }
}
