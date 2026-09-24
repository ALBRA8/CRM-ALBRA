import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  const { searchParams } = new URL(request.url)
  const entity = searchParams.get('entity') || 'client'

  try {
    const fields = await db.customField.findMany({
      where: { userId, entity, isActive: true },
      orderBy: { order: 'asc' },
    })
    return NextResponse.json({ fields })
  } catch {
    return NextResponse.json({ error: 'Error al cargar campos custom' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  try {
    const body = await request.json()
    const { name, fieldType, entity, options, isRequired, order } = body

    if (!name || !fieldType) {
      return NextResponse.json({ error: 'Nombre y tipo son requeridos' }, { status: 400 })
    }

    const field = await db.customField.create({
      data: {
        userId,
        name,
        fieldType,
        entity: entity || 'client',
        options: options ? JSON.stringify(options) : null,
        isRequired: isRequired ?? false,
        order: order ?? 0,
      },
    })
    return NextResponse.json({ field })
  } catch {
    return NextResponse.json({ error: 'Error al crear campo custom' }, { status: 500 })
  }
}
