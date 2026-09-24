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
    const notification = await db.notification.update({
      where: { id, userId },
      data: { isRead: body.isRead ?? true },
    })
    return NextResponse.json({ notification })
  } catch {
    return NextResponse.json({ error: 'Error al actualizar notificación' }, { status: 500 })
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
    // If id is 'all', delete all notifications for user
    if (id === 'all') {
      await db.notification.deleteMany({ where: { userId } })
      return NextResponse.json({ success: true })
    }
    await db.notification.delete({ where: { id, userId } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error al eliminar notificación' }, { status: 500 })
  }
}
