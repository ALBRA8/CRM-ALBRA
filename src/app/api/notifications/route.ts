import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  try {
    const notifications = await db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unreadCount = await db.notification.count({
      where: { userId, isRead: false },
    })
    return NextResponse.json({ notifications, unreadCount })
  } catch {
    return NextResponse.json({ error: 'Error al cargar notificaciones' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  try {
    const body = await request.json()
    const { type, title, message, link } = body

    if (!type || !title || !message) {
      return NextResponse.json({ error: 'Tipo, título y mensaje son requeridos' }, { status: 400 })
    }

    const notification = await db.notification.create({
      data: { userId, type, title, message, link: link || null },
    })
    return NextResponse.json({ notification })
  } catch {
    return NextResponse.json({ error: 'Error al crear notificación' }, { status: 500 })
  }
}
