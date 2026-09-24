import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/whatsapp/conversations/[id] - Get conversation with messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const conversation = await db.whatsAppConversation.findFirst({
      where: { id, userId: authResult.userId },
      include: {
        client: { select: { id: true, name: true, temperature: true, score: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 200,
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
    }

    // Mark messages as read
    await db.whatsAppMessage.updateMany({
      where: { conversationId: id, isRead: false },
      data: { isRead: true },
    });

    await db.whatsAppConversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    console.error('Get conversation error:', error);
    return NextResponse.json({ error: 'Error al obtener conversación' }, { status: 500 });
  }
}

// PUT /api/whatsapp/conversations/[id] - Update conversation
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { isAutoReply, status, transferredTo } = body;

    const updateData: Record<string, unknown> = {};
    if (isAutoReply !== undefined) updateData.isAutoReply = isAutoReply;
    if (status !== undefined) updateData.status = status;
    if (transferredTo !== undefined) updateData.transferredTo = transferredTo;

    const conversation = await db.whatsAppConversation.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    console.error('Update conversation error:', error);
    return NextResponse.json({ error: 'Error al actualizar conversación' }, { status: 500 });
  }
}
