import { NextRequest, NextResponse } from 'next/server'
import { checkPermission, requireAdmin } from '@/lib/permissions'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { z } from 'zod'

// PUT /api/team/[id] - Update team member
const updateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'agent']).optional(),
  phone: z.string().optional(),
  password: z.string().min(6).optional(),
  isActive: z.boolean().optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const perm = await requireAdmin(request)
  if (perm instanceof NextResponse) return perm

  const { id } = await params

  try {
    const body = await request.json()
    const validated = updateSchema.parse(body)

    // Cannot change own role
    if (id === perm.userId && validated.role) {
      return NextResponse.json({ error: 'No puedes cambiar tu propio rol' }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Cannot modify owner
    if (existing.role === 'owner' && perm.role !== 'owner') {
      return NextResponse.json({ error: 'No puedes modificar al propietario' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {}
    if (validated.name) updateData.name = validated.name
    if (validated.email) updateData.email = validated.email
    if (validated.role) updateData.role = validated.role
    if (validated.phone !== undefined) updateData.phone = validated.phone || null
    if (validated.isActive !== undefined) updateData.isActive = validated.isActive
    if (validated.password) {
      updateData.password = await hashPassword(validated.password)
    }

    const updated = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ user: updated, message: 'Miembro actualizado' })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos invalidos', details: error.errors }, { status: 400 })
    }
    console.error('Team update error:', error)
    return NextResponse.json({ error: 'Error al actualizar miembro' }, { status: 500 })
  }
}

// DELETE /api/team/[id] - Deactivate team member
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const perm = await requireAdmin(request)
  if (perm instanceof NextResponse) return perm

  const { id } = await params

  try {
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Cannot deactivate yourself
    if (id === perm.userId) {
      return NextResponse.json({ error: 'No puedes desactivarte a ti mismo' }, { status: 400 })
    }

    // Cannot deactivate owner
    if (existing.role === 'owner') {
      return NextResponse.json({ error: 'No puedes desactivar al propietario' }, { status: 403 })
    }

    // Soft delete - deactivate instead of deleting
    await db.user.update({
      where: { id },
      data: { isActive: false },
    })

    return NextResponse.json({ message: 'Miembro desactivado' })
  } catch (error) {
    console.error('Team delete error:', error)
    return NextResponse.json({ error: 'Error al desactivar miembro' }, { status: 500 })
  }
}
