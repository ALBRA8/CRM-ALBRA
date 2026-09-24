import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { sendTelegramMessage } from '../webhook/route';

// POST /api/telegram/send - Send a Telegram message
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
    const conversation = await db.telegramConversation.findFirst({
      where: { id: conversationId, userId: authResult.userId },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversación no encontrada' },
        { status: 404 }
      );
    }

    // Get Telegram config
    const config = await db.telegramConfig.findFirst({
      where: { userId: authResult.userId, isActive: true },
    });

    if (!config) {
      return NextResponse.json(
        { error: 'Telegram no está configurado' },
        { status: 400 }
      );
    }

    // Determine sender type
    const senderType = conversation.isAutoReply ? 'agent' : 'human';

    // Send via Telegram Bot API
    const sendResult = await sendTelegramMessage(
      config.botToken,
      conversation.chatId,
      text
    );

    // Save outbound message
    const message = await db.telegramMessage.create({
      data: {
        conversationId: conversation.id,
        userId: authResult.userId,
        tgMessageId: sendResult?.message_id ? String(sendResult.message_id) : null,
        direction: 'outbound',
        fromId: conversation.chatId,
        toId: conversation.chatId,
        text,
        messageType: 'text',
        senderType,
        isRead: true,
      },
    });

    // Update conversation
    await db.telegramConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: text.substring(0, 100),
        lastMessageAt: new Date(),
        lastMessageFrom: senderType,
      },
    });

    return NextResponse.json({ message, success: true });
  } catch (error) {
    console.error('Telegram send error:', error);
    return NextResponse.json(
      { error: 'Error al enviar mensaje' },
      { status: 500 }
    );
  }
}
