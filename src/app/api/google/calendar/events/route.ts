import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { refreshGoogleToken } from '../../config/route';

// GET /api/google/calendar/events - List upcoming events
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
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

    // Refresh token if needed
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

    const now = new Date().toISOString();
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=10&orderBy=startTime&singleEvents=true`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Calendar API error:', errorText);
      return NextResponse.json(
        { error: 'Error al obtener eventos' },
        { status: 500 }
      );
    }

    const data = await response.json() as { items?: Array<Record<string, unknown>> };
    return NextResponse.json({ success: true, events: data.items ?? [] });
  } catch (error) {
    console.error('Calendar events error:', error);
    return NextResponse.json({ error: 'Error al obtener eventos' }, { status: 500 });
  }
}

// POST /api/google/calendar/events - Create event
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { summary, description, start, end } = body;

    if (!summary || !start || !end) {
      return NextResponse.json(
        { error: 'summary, start y end son requeridos' },
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

    const eventData = {
      summary,
      description: description ?? '',
      start: { dateTime: start, timeZone: 'America/Lima' },
      end: { dateTime: end, timeZone: 'America/Lima' },
    };

    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventData),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Calendar create error:', errorText);
      return NextResponse.json(
        { error: 'Error al crear evento' },
        { status: 500 }
      );
    }

    const data = await response.json() as Record<string, unknown>;
    return NextResponse.json({ success: true, event: data });
  } catch (error) {
    console.error('Calendar create error:', error);
    return NextResponse.json({ error: 'Error al crear evento' }, { status: 500 });
  }
}
