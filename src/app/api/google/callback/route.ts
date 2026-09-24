import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/google/callback - Handle OAuth callback → exchange code for tokens
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // userId
    const error = searchParams.get('error');

    if (error) {
      console.error('Google OAuth error:', error);
      return NextResponse.redirect(new URL('/?view=settings&tab=google', request.url));
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
    }

    // Find config for this user
    const config = await db.googleConfig.findFirst({
      where: { userId: state },
    });

    if (!config) {
      return NextResponse.json({ error: 'Configuración no encontrada' }, { status: 404 });
    }

    const host = request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const redirectUri = `${protocol}://${host}/api/google/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange error:', errorText);
      return NextResponse.redirect(new URL('/?view=settings&tab=google', request.url));
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
      token_type: string;
    };

    // Save tokens to DB
    await db.googleConfig.update({
      where: { id: config.id },
      data: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? config.refreshToken,
        tokenExpiry: new Date(Date.now() + tokenData.expires_in * 1000),
        scopes: tokenData.scope ?? null,
        isConnected: true,
      },
    });

    // Redirect back to settings page
    return NextResponse.redirect(new URL('/?view=settings&tab=google', request.url));
  } catch (error) {
    console.error('Google callback error:', error);
    return NextResponse.redirect(new URL('/?view=settings&tab=google', request.url));
  }
}
