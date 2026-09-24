import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/whatsapp/config - Get WhatsApp configuration
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.whatsAppConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config) {
      return NextResponse.json({ configured: false, config: null });
    }

    // Mask access token for security
    return NextResponse.json({
      configured: true,
      config: {
        id: config.id,
        phoneNumberId: config.phoneNumberId,
        businessAccountId: config.businessAccountId,
        accessToken: config.accessToken ? '••••••••' + config.accessToken.slice(-4) : '',
        webhookVerifyToken: config.webhookVerifyToken,
        isActive: config.isActive,
        hasAccessToken: !!config.accessToken,
      },
    });
  } catch (error) {
    console.error('Get WhatsApp config error:', error);
    return NextResponse.json({ error: 'Error al obtener configuración' }, { status: 500 });
  }
}

// PUT /api/whatsapp/config - Save/update WhatsApp configuration
export async function PUT(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { phoneNumberId, businessAccountId, accessToken, webhookVerifyToken, webhookSecret } = body;

    if (!phoneNumberId || !businessAccountId || !accessToken || !webhookVerifyToken) {
      return NextResponse.json(
        { error: 'Todos los campos son requeridos' },
        { status: 400 }
      );
    }

    const existing = await db.whatsAppConfig.findFirst({
      where: { userId: authResult.userId },
    });

    let config;
    if (existing) {
      config = await db.whatsAppConfig.update({
        where: { id: existing.id },
        data: {
          phoneNumberId,
          businessAccountId,
          accessToken,
          webhookVerifyToken,
          webhookSecret: webhookSecret ?? null,
          isActive: true,
        },
      });
    } else {
      config = await db.whatsAppConfig.create({
        data: {
          userId: authResult.userId,
          phoneNumberId,
          businessAccountId,
          accessToken,
          webhookVerifyToken,
          webhookSecret: webhookSecret ?? null,
          isActive: true,
        },
      });
    }

    return NextResponse.json({ success: true, config: { id: config.id, isActive: config.isActive } });
  } catch (error) {
    console.error('Save WhatsApp config error:', error);
    return NextResponse.json({ error: 'Error al guardar configuración' }, { status: 500 });
  }
}

// DELETE /api/whatsapp/config - Disconnect WhatsApp
export async function DELETE(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.whatsAppConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (config) {
      await db.whatsAppConfig.update({
        where: { id: config.id },
        data: { isActive: false },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Disconnect WhatsApp error:', error);
    return NextResponse.json({ error: 'Error al desconectar' }, { status: 500 });
  }
}
