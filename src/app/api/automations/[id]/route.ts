import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// PUT /api/automations/[id] - Update automation
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, type, trigger, conditions, actions, message, isActive } = body;

    const existing = await db.automation.findFirst({
      where: { id, userId: authResult.userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Automatización no encontrada' },
        { status: 404 }
      );
    }

    const automation = await db.automation.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(trigger !== undefined && { trigger }),
        ...(conditions !== undefined && { conditions: JSON.stringify(conditions) }),
        ...(actions !== undefined && { actions: typeof actions === 'string' ? actions : JSON.stringify(actions) }),
        ...(message !== undefined && { message }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json({ automation });
  } catch (error) {
    console.error('Update automation error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar automatización' },
      { status: 500 }
    );
  }
}

// DELETE /api/automations/[id] - Delete automation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  const existing = await db.automation.findFirst({
    where: { id, userId: authResult.userId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: 'Automatización no encontrada' },
      { status: 404 }
    );
  }

  await db.automation.delete({
    where: { id },
  });

  return NextResponse.json({ message: 'Automatización eliminada exitosamente' });
}
