import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { sendWhatsAppMessage } from '../webhook/route';

// POST /api/whatsapp/send - Send a WhatsApp message
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { conversationId, text } = body;

    if (!conversationId || !text) {
      return NextResponse.json(
        { error: 'conversationId y text son requeridos' },
        { status: 400 }
      );
    }

    // Find conversation
    const conversation = await db.whatsAppConversation.findFirst({
      where: { id: conversationId, userId: authResult.userId },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversación no encontrada' },
        { status: 404 }
      );
    }

    // Get WhatsApp config
    const config = await db.whatsAppConfig.findFirst({
      where: { userId: authResult.userId, isActive: true },
    });

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp no está configurado' },
        { status: 400 }
      );
    }

    // Determine sender type
    const senderType = conversation.isAutoReply ? 'agent' : 'human';

    // Send via Meta API
    const sendResult = await sendWhatsAppMessage(
      config.accessToken,
      config.phoneNumberId,
      conversation.contactPhone,
      text
    );

    // Save outbound message
    const message = await db.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        userId: authResult.userId,
        waMessageId: sendResult?.message_id ?? null,
        direction: 'outbound',
        fromNumber: config.phoneNumberId,
        toNumber: conversation.contactPhone,
        text,
        messageType: 'text',
        senderType,
        isRead: true,
      },
    });

    // Update conversation
    await db.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: text.substring(0, 100),
        lastMessageAt: new Date(),
        lastMessageFrom: senderType,
      },
    });

    return NextResponse.json({ message, success: true });
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return NextResponse.json(
      { error: 'Error al enviar mensaje' },
      { status: 500 }
    );
  }
}
