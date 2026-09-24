import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth
  const { id } = await params

  try {
    const template = await db.messageTemplate.findFirst({ where: { id, userId } })
    if (!template) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 })
    return NextResponse.json({ template })
  } catch {
    return NextResponse.json({ error: 'Error al cargar plantilla' }, { status: 500 })
  }
}

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
    const template = await db.messageTemplate.update({
      where: { id, userId },
      data: {
        name: body.name,
        channel: body.channel,
        subject: body.subject || null,
        content: body.content,
        variables: body.variables ? JSON.stringify(body.variables) : null,
        category: body.category || null,
        isActive: body.isActive ?? true,
      },
    })
    return NextResponse.json({ template })
  } catch {
    return NextResponse.json({ error: 'Error al actualizar plantilla' }, { status: 500 })
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
    await db.messageTemplate.delete({ where: { id, userId } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error al eliminar plantilla' }, { status: 500 })
  }
}
