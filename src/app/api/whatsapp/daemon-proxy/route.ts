import { NextRequest, NextResponse } from 'next/server';

const DAEMON_BASE = 'http://localhost:3002';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'crm-albra-internal-2024';

// Proxy requests to the WhatsApp daemon running on port 3002
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path') || '/status';

  try {
    const res = await fetch(`${DAEMON_BASE}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Daemon not reachable';
    return NextResponse.json(
      { status: 'daemon_offline', error: msg, phone: null, lastUpdate: null },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const path = body.path || '/connect';
    const method = body.method || 'POST';
    const data = body.data || {};

    const res = await fetch(`${DAEMON_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INTERNAL_SECRET}`,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });

    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Daemon not reachable';
    return NextResponse.json(
      { error: msg, success: false },
      { status: 503 }
    );
  }
}
