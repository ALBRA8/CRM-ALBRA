import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { refreshGoogleToken } from '../../config/route';

// POST /api/google/gmail/send - Send email via Gmail API
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { to, subject, body: emailBody } = body;

    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { error: 'to, subject y body son requeridos' },
        { status: 400 }
      );
    }

    const config = await db.googleConfig.findFirst({
      where: { userId: authResult.userId, isConnected: true },
    });

    if (!config || !config.accessToken) {
      return NextResponse.json(
        { error: 'Google no está conectado' },
        { status: 400 }
      );
    }

    let accessToken = config.accessToken;

    // Check if token needs refresh
    if (config.tokenExpiry && new Date(config.tokenExpiry) < new Date()) {
      if (!config.refreshToken) {
        return NextResponse.json(
          { error: 'Token expirado. Reconecta tu cuenta de Google.' },
          { status: 401 }
        );
      }
      const refreshed = await refreshGoogleToken({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
      });
      if (!refreshed) {
        return NextResponse.json(
          { error: 'Error al refrescar token. Reconecta tu cuenta.' },
          { status: 401 }
        );
      }
      accessToken = refreshed.access_token;
      await db.googleConfig.update({
        where: { id: config.id },
        data: {
          accessToken: refreshed.access_token,
          tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
        },
      });
    }

    // Build raw email
    const email = [
      `To: ${to}`,
      `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      emailBody,
    ].join('\n');

    const rawEmail = Buffer.from(email).toString('base64url');

    // Send via Gmail API
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: rawEmail }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gmail API error:', errorText);
      return NextResponse.json(
        { error: 'Error al enviar email via Gmail' },
        { status: 500 }
      );
    }

    const data = await response.json() as { id: string; threadId: string };
    return NextResponse.json({ success: true, messageId: data.id, threadId: data.threadId });
  } catch (error) {
    console.error('Gmail send error:', error);
    return NextResponse.json(
      { error: 'Error al enviar email' },
      { status: 500 }
    );
  }
}
