import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { processAgentMessage } from '@/lib/agent/core';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

// POST /api/chat - Process chat message with AI agent
// Supports both UI chat and WhatsApp daemon auto-reply
export async function POST(request: NextRequest) {
  try {
    // Rate limit: 30 messages per minute per IP
    const clientIp = getClientIdentifier(request)
    const rateCheck = checkRateLimit(`chat:${clientIp}`, { maxRequests: 30, windowMs: 60 * 1000 })
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Demasiados mensajes. Espera un momento.' },
        { status: 429 }
      )
    }

    const body = await request.json();
    const { message, clientId, conversationHistory: providedHistory, source } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'message es requerido y debe ser un string' },
        { status: 400 }
      );
    }

    let userId: string;

    // If called from WhatsApp/Telegram daemon (internal), verify shared secret
    if (source === 'whatsapp' || source === 'telegram') {
      // Verify internal shared secret to prevent abuse
      const internalSecret = process.env.INTERNAL_API_SECRET || 'crm-albra-internal-2024';
      const providedSecret = request.headers.get('X-Internal-Secret');
      if (providedSecret !== internalSecret) {
        return NextResponse.json({ error: 'Unauthorized internal request' }, { status: 401 });
      }
      // Find the first user (single-tenant mode)
      const user = await db.user.findFirst({ where: { isActive: true } });
      if (!user) {
        return NextResponse.json({ error: 'No active user found' }, { status: 500 });
      }
      userId = user.id;
    } else {
      // Normal UI chat - require auth
      const authResult = await getAuthUser(request);
      if (authResult instanceof NextResponse) return authResult;
      userId = authResult.userId;
    }

    let conversationHistory = providedHistory;

    // If no history provided, load from DB
    if (!conversationHistory || !Array.isArray(conversationHistory) || conversationHistory.length === 0) {
      const historyFilter: Record<string, unknown> = {
        userId,
        role: { in: ['user', 'assistant'] },
      };

      if (clientId) {
        historyFilter.clientId = clientId;
      }

      const chatHistory = await db.chatLog.findMany({
        where: historyFilter,
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      conversationHistory = chatHistory
        .reverse()
        .map((log) => ({
          role: log.role,
          content: log.content,
        }));
    }

    // Process with agent
    const response = await processAgentMessage(
      userId,
      message,
      clientId,
      conversationHistory
    );

    return NextResponse.json({
      content: response.content,
      toolCalls: response.toolCalls,
      suggestions: response.suggestions,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Error al procesar mensaje' },
      { status: 500 }
    );
  }
}
