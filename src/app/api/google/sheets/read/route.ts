import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { refreshGoogleToken } from '../../config/route';

// POST /api/google/sheets/read - Read sheet data by spreadsheetId + range
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { spreadsheetId, range } = body;

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'spreadsheetId es requerido' },
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

    if (config.tokenExpiry && new Date(config.tokenExpiry) < new Date()) {
      if (!config.refreshToken) {
        return NextResponse.json({ error: 'Token expirado' }, { status: 401 });
      }
      const refreshed = await refreshGoogleToken({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
      });
      if (!refreshed) {
        return NextResponse.json({ error: 'Error al refrescar token' }, { status: 401 });
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

    const encodedRange = range ? encodeURIComponent(range) : '';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Sheets API error:', errorText);
      return NextResponse.json(
        { error: 'Error al leer Google Sheet' },
        { status: 500 }
      );
    }

    const data = await response.json() as { values?: string[][] };
    return NextResponse.json({ success: true, values: data.values ?? [] });
  } catch (error) {
    console.error('Sheets read error:', error);
    return NextResponse.json({ error: 'Error al leer Google Sheet' }, { status: 500 });
  }
}
