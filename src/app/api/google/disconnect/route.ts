import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// POST /api/google/disconnect - Revoke tokens and clear config
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.googleConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config) {
      return NextResponse.json({ success: true });
    }

    // Try to revoke the access token
    if (config.accessToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${config.accessToken}`, {
          method: 'POST',
        });
      } catch {
        // Ignore revocation errors
      }
    }

    // Clear tokens but keep client ID/secret
    await db.googleConfig.update({
      where: { id: config.id },
      data: {
        accessToken: null,
        refreshToken: null,
        tokenExpiry: null,
        scopes: null,
        isConnected: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Google disconnect error:', error);
    return NextResponse.json({ error: 'Error al desconectar' }, { status: 500 });
  }
}
