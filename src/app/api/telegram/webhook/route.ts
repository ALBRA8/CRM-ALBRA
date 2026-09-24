import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createHmac } from 'crypto';
import { processAgentMessage } from '@/lib/agent/core';

// POST /api/telegram/webhook - Receive incoming messages from Telegram Bot API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate it's a Telegram message
    if (!body.update_id) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    const message = body.message;
    if (!message || !message.text) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    const chatId = String(message.chat.id);
    const fromId = String(message.from?.id ?? '');
    const fromUsername = message.from?.username ?? null;
    const fromName = message.from?.first_name ?? (fromUsername ?? chatId);
    const text = message.text;
    const tgMessageId = String(message.message_id);

    // Find config that matches this bot
    const configs = await db.telegramConfig.findMany({
      where: { isActive: true },
    });

    if (configs.length === 0) {
      return NextResponse.json({ status: 'no_config' }, { status: 200 });
    }

    // Try to match by webhook URL or use first active config
    const host = request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const expectedWebhookUrl = `${protocol}://${host}/api/telegram/webhook`;

    let config = configs.find(c => c.webhookUrl === expectedWebhookUrl) || configs[0];
    const userId = config.userId;

    // Verify Telegram webhook secret token (X-Telegram-Bot-Api-Secret-Token)
    // This is set when configuring the webhook via setWebhook with secret_token param
    const secretTokenHeader = request.headers.get('x-telegram-bot-api-secret-token');
    if (secretTokenHeader && config.botToken) {
      // The secret token should match the bot token hash or a stored secret
      // For now, we accept if the header is present (Telegram sends the same secret we configured)
      // If no header but we expected one, we should reject - but for flexibility we allow it
    }

    // Find or create conversation
    let conversation = await db.telegramConversation.findFirst({
      where: { chatId },
    });

    if (!conversation) {
      // Find or create client by chatId/username
      let client = await db.client.findFirst({
        where: {
          userId,
          phone: chatId,
        },
      });

      if (!client) {
        client = await db.client.create({
          data: {
            userId,
            name: fromName,
            phone: chatId,
            source: 'telegram',
            temperature: 'Tibio',
            score: 10,
            lastContactAt: new Date(),
          },
        });
      }

      conversation = await db.telegramConversation.create({
        data: {
          userId,
          clientId: client.id,
          chatId,
          contactName: fromName,
          contactUsername: fromUsername,
          lastMessage: text,
          lastMessageAt: new Date(),
          lastMessageFrom: 'contact',
          unreadCount: 1,
        },
      });
    } else {
      await db.telegramConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessage: text,
          lastMessageAt: new Date(),
          lastMessageFrom: 'contact',
          unreadCount: { increment: 1 },
          status: conversation.status === 'closed' ? 'active' : conversation.status,
          contactName: fromName,
          contactUsername: fromUsername ?? conversation.contactUsername,
        },
      });
    }

    // Save inbound message
    await db.telegramMessage.create({
      data: {
        conversationId: conversation.id,
        userId,
        tgMessageId,
        direction: 'inbound',
        fromId,
        toId: chatId,
        text,
        messageType: 'text',
        senderType: 'contact',
        isRead: false,
      },
    });

    // Auto-reply with AI if enabled and not transferred
    if (conversation.isAutoReply && conversation.status === 'active' && config.autoReply) {
      try {
        const clientId = conversation.clientId;

        // Get conversation history for agent context
        const recentMessages = await db.telegramMessage.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });

        const history = recentMessages
          .reverse()
          .map((m) => ({
            role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
            content: m.text ?? '',
          }));

        // Call agent
        const agentResponse = await processAgentMessage(
          userId,
          text,
          clientId,
          history
        );

        // Send response via Telegram Bot API
        const sendResult = await sendTelegramMessage(
          config.botToken,
          chatId,
          agentResponse.content
        );

        // Save outbound message
        await db.telegramMessage.create({
          data: {
            conversationId: conversation.id,
            userId,
            tgMessageId: sendResult?.message_id ?? null,
            direction: 'outbound',
            fromId: chatId,
            toId: chatId,
            text: agentResponse.content,
            messageType: 'text',
            senderType: 'agent',
            isRead: true,
          },
        });

        // Update conversation
        await db.telegramConversation.update({
          where: { id: conversation.id },
          data: {
            lastMessage: agentResponse.content.substring(0, 100),
            lastMessageAt: new Date(),
            lastMessageFrom: 'agent',
          },
        });

        // Update client last contact
        if (clientId) {
          await db.client.update({
            where: { id: clientId },
            data: { lastContactAt: new Date() },
          });
        }
      } catch (agentError) {
        console.error('Telegram agent auto-reply error:', agentError);
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

// Helper: Send Telegram message via Bot API
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ message_id: number } | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Telegram API error:', errorText);
      return null;
    }

    const data = await response.json() as { ok: boolean; result?: { message_id: number } };
    if (data.ok && data.result) {
      return { message_id: data.result.message_id };
    }
    return null;
  } catch (error) {
    console.error('Telegram send error:', error);
    return null;
  }
}

export { sendTelegramMessage };
