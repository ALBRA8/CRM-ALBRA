import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/whatsapp/conversations - List conversations
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const conversations = await db.whatsAppConversation.findMany({
      where: { userId: authResult.userId },
      include: {
        client: { select: { id: true, name: true, temperature: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('List conversations error:', error);
    return NextResponse.json({ error: 'Error al listar conversaciones' }, { status: 500 });
  }
}

// POST /api/whatsapp/conversations - Create conversation manually
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { contactPhone, contactName, clientId } = body;

    if (!contactPhone) {
      return NextResponse.json({ error: 'contactPhone es requerido' }, { status: 400 });
    }

    // Check if conversation already exists
    const existing = await db.whatsAppConversation.findFirst({
      where: { userId: authResult.userId, contactPhone },
    });

    if (existing) {
      return NextResponse.json({ conversation: existing });
    }

    const conversation = await db.whatsAppConversation.create({
      data: {
        userId: authResult.userId,
        clientId: clientId ?? null,
        contactPhone,
        contactName: contactName ?? contactPhone,
      },
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    console.error('Create conversation error:', error);
    return NextResponse.json({ error: 'Error al crear conversación' }, { status: 500 });
  }
}
