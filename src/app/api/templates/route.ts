import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  const { searchParams } = new URL(request.url)
  const channel = searchParams.get('channel')

  try {
    const where: Record<string, unknown> = { userId }
    if (channel) where.channel = channel

    const templates = await db.messageTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ templates })
  } catch {
    return NextResponse.json({ error: 'Error al cargar plantillas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth
  const { userId } = auth

  try {
    const body = await request.json()
    const { name, channel, subject, content, variables, category } = body

    if (!name || !content) {
      return NextResponse.json({ error: 'Nombre y contenido son requeridos' }, { status: 400 })
    }

    const template = await db.messageTemplate.create({
      data: {
        userId,
        name,
        channel: channel || 'whatsapp',
        subject: subject || null,
        content,
        variables: variables ? JSON.stringify(variables) : null,
        category: category || null,
      },
    })
    return NextResponse.json({ template })
  } catch {
    return NextResponse.json({ error: 'Error al crear plantilla' }, { status: 500 })
  }
}
