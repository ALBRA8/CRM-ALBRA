import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function PUT(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  try {
    const result = await db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })
    return NextResponse.json({ success: true, count: result.count })
  } catch {
    return NextResponse.json({ error: 'Error al marcar notificaciones como leídas' }, { status: 500 })
  }
}
