import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/telegram/config - Get Telegram configuration
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.telegramConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config) {
      return NextResponse.json({ configured: false, config: null });
    }

    return NextResponse.json({
      configured: true,
      config: {
        id: config.id,
        botToken: config.botToken ? '••••••••' + config.botToken.slice(-4) : '',
        webhookUrl: config.webhookUrl,
        botUsername: config.botUsername,
        isActive: config.isActive,
        autoReply: config.autoReply,
        hasBotToken: !!config.botToken,
      },
    });
  } catch (error) {
    console.error('Get Telegram config error:', error);
    return NextResponse.json({ error: 'Error al obtener configuración' }, { status: 500 });
  }
}

// PUT /api/telegram/config - Save/update Telegram configuration
export async function PUT(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { botToken, autoReply, webhookUrl, botUsername } = body;

    if (!botToken) {
      return NextResponse.json(
        { error: 'Bot token es requerido' },
        { status: 400 }
      );
    }

    const existing = await db.telegramConfig.findFirst({
      where: { userId: authResult.userId },
    });

    let config;
    if (existing) {
      config = await db.telegramConfig.update({
        where: { id: existing.id },
        data: {
          botToken,
          autoReply: autoReply ?? existing.autoReply,
          webhookUrl: webhookUrl ?? existing.webhookUrl,
          botUsername: botUsername ?? existing.botUsername,
          isActive: true,
        },
      });
    } else {
      config = await db.telegramConfig.create({
        data: {
          userId: authResult.userId,
          botToken,
          autoReply: autoReply ?? true,
          webhookUrl: webhookUrl ?? null,
          botUsername: botUsername ?? null,
          isActive: true,
        },
      });
    }

    return NextResponse.json({ success: true, config: { id: config.id, isActive: config.isActive } });
  } catch (error) {
    console.error('Save Telegram config error:', error);
    return NextResponse.json({ error: 'Error al guardar configuración' }, { status: 500 });
  }
}

// DELETE /api/telegram/config - Disconnect Telegram bot
export async function DELETE(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.telegramConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (config) {
      await db.telegramConfig.update({
        where: { id: config.id },
        data: { isActive: false, webhookUrl: null },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Disconnect Telegram error:', error);
    return NextResponse.json({ error: 'Error al desconectar' }, { status: 500 });
  }
}
