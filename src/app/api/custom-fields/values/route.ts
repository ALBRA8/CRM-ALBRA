import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  const { searchParams } = new URL(request.url)
  const entityId = searchParams.get('entityId')
  const entity = searchParams.get('entity') || 'client'

  if (!entityId) {
    return NextResponse.json({ error: 'entityId es requerido' }, { status: 400 })
  }

  try {
    const values = await db.customFieldValue.findMany({
      where: { userId, entityId },
      include: { field: true },
    })
    // Filter by entity type via the field relation
    const filtered = values.filter(v => v.field.entity === entity)
    return NextResponse.json({ values: filtered })
  } catch {
    return NextResponse.json({ error: 'Error al cargar valores' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  try {
    const body = await request.json()
    const { entityId, fields } = body as { entityId: string; fields: { fieldId: string; value: string | null }[] }

    if (!entityId || !fields || !Array.isArray(fields)) {
      return NextResponse.json({ error: 'entityId y fields son requeridos' }, { status: 400 })
    }

    for (const f of fields) {
      await db.customFieldValue.upsert({
        where: {
          fieldId_entityId: { fieldId: f.fieldId, entityId },
        },
        create: {
          userId,
          fieldId: f.fieldId,
          entityId,
          value: f.value ?? null,
        },
        update: {
          value: f.value ?? null,
        },
      })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error al guardar valores' }, { status: 500 })
  }
}
