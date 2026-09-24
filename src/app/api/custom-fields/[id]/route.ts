import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth
  const { id } = await params

  try {
    const body = await request.json()
    const field = await db.customField.update({
      where: { id, userId },
      data: {
        name: body.name,
        fieldType: body.fieldType,
        entity: body.entity,
        options: body.options ? JSON.stringify(body.options) : null,
        isRequired: body.isRequired,
        order: body.order,
        isActive: body.isActive ?? true,
      },
    })
    return NextResponse.json({ field })
  } catch {
    return NextResponse.json({ error: 'Error al actualizar campo' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth
  const { id } = await params

  try {
    await db.customFieldValue.deleteMany({ where: { fieldId: id } })
    await db.customField.delete({ where: { id, userId } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error al eliminar campo' }, { status: 500 })
  }
}
