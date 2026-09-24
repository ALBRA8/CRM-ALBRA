import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/inventory/status - Get last sync time, results, status
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.inventorySyncConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config) {
      return NextResponse.json({
        configured: false,
        lastSyncAt: null,
        lastSyncResult: null,
        isActive: false,
      });
    }

    return NextResponse.json({
      configured: true,
      lastSyncAt: config.lastSyncAt,
      lastSyncResult: config.lastSyncResult ? JSON.parse(config.lastSyncResult) : null,
      isActive: config.isActive,
      syncInterval: config.syncInterval,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
    });
  } catch (error) {
    console.error('Get inventory status error:', error);
    return NextResponse.json({ error: 'Error al obtener estado' }, { status: 500 });
  }
}
