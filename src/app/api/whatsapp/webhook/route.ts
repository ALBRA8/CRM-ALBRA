import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { processAgentMessage } from '@/lib/agent/core';

// GET - Webhook verification (Meta requirement)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token) {
    // Find a config with this verify token
    const config = await db.whatsAppConfig.findFirst({
      where: { webhookVerifyToken: token },
    });

    if (config) {
      return new NextResponse(challenge, { status: 200 });
    }
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// POST - Receive incoming WhatsApp messages
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate it's a WhatsApp message event
    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    // Process each entry
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages;
        const contacts = change.value?.contacts;
        const metadata = change.value?.metadata;

        if (!messages || messages.length === 0) continue;

        const phoneNumberId = metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // Find the config for this phone number
        const config = await db.whatsAppConfig.findFirst({
          where: { phoneNumberId, isActive: true },
        });

        if (!config) continue;

        const userId = config.userId;

        for (const msg of messages) {
          if (msg.type !== 'text') continue; // Only handle text for now

          const from = msg.from; // Contact phone number
          const text = msg.text?.body ?? '';
          const waMessageId = msg.id;
          const contactInfo = contacts?.find((c: { wa_id: string }) => c.wa_id === from);
          const contactName = contactInfo?.profile?.name ?? from;

          // Find or create conversation
          let conversation = await db.whatsAppConversation.findFirst({
            where: { userId, contactPhone: from },
          });

          if (!conversation) {
            // Find or create client by phone
            let client = await db.client.findFirst({
              where: { userId, phone: from },
            });

            if (!client) {
              client = await db.client.create({
                data: {
                  userId,
                  name: contactName,
                  phone: from,
                  source: 'whatsapp',
                  temperature: 'Tibio',
                  score: 10,
                  lastContactAt: new Date(),
                },
              });
            }

            conversation = await db.whatsAppConversation.create({
              data: {
                userId,
                clientId: client.id,
                contactPhone: from,
                contactName,
                lastMessage: text,
                lastMessageAt: new Date(),
                lastMessageFrom: 'contact',
                unreadCount: 1,
              },
            });
          } else {
            await db.whatsAppConversation.update({
              where: { id: conversation.id },
              data: {
                lastMessage: text,
                lastMessageAt: new Date(),
                lastMessageFrom: 'contact',
                unreadCount: { increment: 1 },
                status: conversation.status === 'closed' ? 'active' : conversation.status,
              },
            });
          }

          // Save inbound message
          await db.whatsAppMessage.create({
            data: {
              conversationId: conversation.id,
              userId,
              waMessageId,
              direction: 'inbound',
              fromNumber: from,
              toNumber: phoneNumberId,
              text,
              messageType: 'text',
              senderType: 'contact',
              isRead: false,
            },
          });

          // Auto-reply with AI if enabled and not transferred
          if (conversation.isAutoReply && conversation.status === 'active') {
            try {
              const clientId = conversation.clientId;

              // Get conversation history for agent context
              const recentMessages = await db.whatsAppMessage.findMany({
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

              // Send response via WhatsApp API
              const sendResult = await sendWhatsAppMessage(
                config.accessToken,
                config.phoneNumberId,
                from,
                agentResponse.content
              );

              // Save outbound message
              await db.whatsAppMessage.create({
                data: {
                  conversationId: conversation.id,
                  userId,
                  waMessageId: sendResult?.message_id ?? null,
                  direction: 'outbound',
                  fromNumber: phoneNumberId,
                  toNumber: from,
                  text: agentResponse.content,
                  messageType: 'text',
                  senderType: 'agent',
                  isRead: true,
                },
              });

              // Update conversation
              await db.whatsAppConversation.update({
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
              console.error('Agent auto-reply error:', agentError);
              // Don't fail the webhook - just log the error
            }
          }
        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

// Helper: Send WhatsApp message via Meta Cloud API
async function sendWhatsAppMessage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  text: string
): Promise<{ message_id: string } | null> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('WhatsApp API error:', errorText);
      return null;
    }

    const data = await response.json() as { messages?: Array<{ id: string }> };
    return { message_id: data.messages?.[0]?.id ?? '' };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return null;
  }
}

export { sendWhatsAppMessage };
