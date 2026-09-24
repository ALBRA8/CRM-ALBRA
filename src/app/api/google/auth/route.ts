import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/google/auth - Start OAuth flow → redirect to Google consent screen
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.googleConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config || !config.clientId) {
      return NextResponse.json(
        { error: 'Configura Client ID y Client Secret primero' },
        { status: 400 }
      );
    }

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ];

    const host = request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const redirectUri = `${protocol}://${host}/api/google/callback`;

    // Update redirect URI
    await db.googleConfig.update({
      where: { id: config.id },
      data: { redirectUri },
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: authResult.userId,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Google auth error:', error);
    return NextResponse.json({ error: 'Error al iniciar autenticación' }, { status: 500 });
  }
}
