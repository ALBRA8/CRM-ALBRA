import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkPermission } from '@/lib/permissions';

// GET /api/services - List services (includes inactive)
export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'services', 'read');
  if (perm instanceof NextResponse) return perm;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') ?? '';
  const includeInactive = searchParams.get('all') === 'true';

  const where: Record<string, unknown> = {
    userId: perm.userId,
  };

  if (!includeInactive) {
    // By default only active, but for the products page we want all
  }

  if (category) where.category = category;

  const services = await db.service.findMany({
    where,
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ services });
}

// POST /api/services - Create service
export async function POST(request: NextRequest) {
  const perm = await checkPermission(request, 'services', 'create');
  if (perm instanceof NextResponse) return perm;

  try {
    const body = await request.json();
    const { name, description, category, price, duration } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'name es requerido' },
        { status: 400 }
      );
    }

    const service = await db.service.create({
      data: {
        userId: perm.userId,
        name,
        description,
        category,
        price: price ?? 0,
        duration: duration ?? 60,
      },
    });

    return NextResponse.json({ service }, { status: 201 });
  } catch (error) {
    console.error('Create service error:', error);
    return NextResponse.json(
      { error: 'Error al crear servicio' },
      { status: 500 }
    );
  }
}

// PUT /api/services - Update service
export async function PUT(request: NextRequest) {
  const perm = await checkPermission(request, 'services', 'update');
  if (perm instanceof NextResponse) return perm;

  try {
    const body = await request.json();
    const { id, name, description, category, price, duration, isActive } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'id es requerido' },
        { status: 400 }
      );
    }

    // Verify ownership
    const existing = await db.service.findFirst({
      where: { id, userId: perm.userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Servicio no encontrado' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (price !== undefined) updateData.price = price;
    if (duration !== undefined) updateData.duration = duration;
    if (isActive !== undefined) updateData.isActive = isActive;

    const service = await db.service.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ service });
  } catch (error) {
    console.error('Update service error:', error);
    return NextResponse.json(
      { error: 'Error al actualizar servicio' },
      { status: 500 }
    );
  }
}

// DELETE /api/services - Delete service
export async function DELETE(request: NextRequest) {
  const perm = await checkPermission(request, 'services', 'delete');
  if (perm instanceof NextResponse) return perm;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id es requerido' },
        { status: 400 }
      );
    }

    // Verify ownership
    const existing = await db.service.findFirst({
      where: { id, userId: perm.userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Servicio no encontrado' },
        { status: 404 }
      );
    }

    await db.service.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete service error:', error);
    return NextResponse.json(
      { error: 'Error al eliminar servicio' },
      { status: 500 }
    );
  }
}
