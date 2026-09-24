import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  const { searchParams } = new URL(request.url)
  const entity = searchParams.get('entity')
  const entityId = searchParams.get('entityId')
  const action = searchParams.get('action')
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    const where: Record<string, unknown> = { userId }
    if (entity) where.entity = entity
    if (entityId) where.entityId = entityId
    if (action) where.action = action

    const logs = await db.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ logs })
  } catch {
    return NextResponse.json({ error: 'Error al cargar actividad' }, { status: 500 })
  }
}
