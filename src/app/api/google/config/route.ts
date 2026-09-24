import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/google/config - Get Google configuration status
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.googleConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config) {
      return NextResponse.json({
        configured: false,
        connected: false,
        config: null,
      });
    }

    // Check if token is expired and try to refresh
    let isConnected = config.isConnected;
    if (isConnected && config.tokenExpiry && new Date(config.tokenExpiry) < new Date()) {
      // Try to refresh the token
      if (config.refreshToken) {
        try {
          const refreshResult = await refreshGoogleToken(config);
          if (refreshResult) {
            await db.googleConfig.update({
              where: { id: config.id },
              data: {
                accessToken: refreshResult.access_token,
                tokenExpiry: new Date(Date.now() + refreshResult.expires_in * 1000),
                scopes: refreshResult.scope ?? config.scopes,
              },
            });
          } else {
            isConnected = false;
          }
        } catch {
          isConnected = false;
        }
      } else {
        isConnected = false;
      }
    }

    return NextResponse.json({
      configured: !!(config.clientId && config.clientSecret),
      connected: isConnected,
      config: {
        id: config.id,
        clientId: config.clientId ? '••••••••' + config.clientId.slice(-4) : '',
        clientSecret: config.clientSecret ? '••••••••' : '',
        redirectUri: config.redirectUri,
        scopes: config.scopes ? JSON.parse(config.scopes) : [],
        isConnected,
        hasTokens: !!(config.accessToken && config.refreshToken),
      },
    });
  } catch (error) {
    console.error('Get Google config error:', error);
    return NextResponse.json({ error: 'Error al obtener configuración' }, { status: 500 });
  }
}

// PUT /api/google/config - Save Google OAuth credentials
export async function PUT(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { clientId, clientSecret } = body;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Client ID y Client Secret son requeridos' },
        { status: 400 }
      );
    }

    const host = request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const redirectUri = `${protocol}://${host}/api/google/callback`;

    const existing = await db.googleConfig.findFirst({
      where: { userId: authResult.userId },
    });

    let config;
    if (existing) {
      config = await db.googleConfig.update({
        where: { id: existing.id },
        data: {
          clientId,
          clientSecret,
          redirectUri,
        },
      });
    } else {
      config = await db.googleConfig.create({
        data: {
          userId: authResult.userId,
          clientId,
          clientSecret,
          redirectUri,
          isConnected: false,
        },
      });
    }

    return NextResponse.json({ success: true, config: { id: config.id, redirectUri } });
  } catch (error) {
    console.error('Save Google config error:', error);
    return NextResponse.json({ error: 'Error al guardar configuración' }, { status: 500 });
  }
}

// Helper: Refresh Google access token
async function refreshGoogleToken(config: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ access_token: string; expires_in: number; scope?: string } | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      console.error('Token refresh error:', await response.text());
      return null;
    }

    return await response.json() as { access_token: string; expires_in: number; scope?: string };
  } catch (error) {
    console.error('Token refresh error:', error);
    return null;
  }
}

export { refreshGoogleToken };
