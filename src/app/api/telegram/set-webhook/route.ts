import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// POST /api/telegram/set-webhook - Register webhook URL with Telegram
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.telegramConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config || !config.botToken) {
      return NextResponse.json(
        { error: 'Configura el Bot Token primero' },
        { status: 400 }
      );
    }

    // First verify the bot token by calling getMe
    const meResponse = await fetch(
      `https://api.telegram.org/bot${config.botToken}/getMe`
    );

    if (!meResponse.ok) {
      return NextResponse.json(
        { error: 'Bot Token inválido. Verifica el token con @BotFather.' },
        { status: 400 }
      );
    }

    const meData = await meResponse.json() as { ok: boolean; result?: { username?: string; first_name?: string } };

    if (!meData.ok || !meData.result) {
      return NextResponse.json(
        { error: 'Bot Token inválido' },
        { status: 400 }
      );
    }

    const botUsername = meData.result.username ?? null;

    // Construct webhook URL from request host
    const host = request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;

    // Set webhook
    const webhookResponse = await fetch(
      `https://api.telegram.org/bot${config.botToken}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message'],
        }),
      }
    );

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error('Telegram setWebhook error:', errorText);
      return NextResponse.json(
        { error: 'Error al configurar webhook de Telegram' },
        { status: 500 }
      );
    }

    const webhookData = await webhookResponse.json() as { ok: boolean; description?: string };

    if (!webhookData.ok) {
      return NextResponse.json(
        { error: webhookData.description || 'Error al configurar webhook' },
        { status: 500 }
      );
    }

    // Update config with webhook URL and bot info
    await db.telegramConfig.update({
      where: { id: config.id },
      data: {
        webhookUrl,
        botUsername,
        isActive: true,
      },
    });

    return NextResponse.json({
      success: true,
      botUsername,
      webhookUrl,
    });
  } catch (error) {
    console.error('Telegram set-webhook error:', error);
    return NextResponse.json(
      { error: 'Error al configurar webhook' },
      { status: 500 }
    );
  }
}
