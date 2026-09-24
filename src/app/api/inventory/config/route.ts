import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/inventory/config - Get inventory sync configuration
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const config = await db.inventorySyncConfig.findFirst({
      where: { userId: authResult.userId },
    });

    if (!config) {
      return NextResponse.json({ configured: false, config: null });
    }

    return NextResponse.json({
      configured: true,
      config: {
        id: config.id,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName,
        range: config.range,
        columnMap: config.columnMap ? JSON.parse(config.columnMap) : null,
        syncInterval: config.syncInterval,
        lastSyncAt: config.lastSyncAt,
        lastSyncResult: config.lastSyncResult ? JSON.parse(config.lastSyncResult) : null,
        isActive: config.isActive,
      },
    });
  } catch (error) {
    console.error('Get inventory config error:', error);
    return NextResponse.json({ error: 'Error al obtener configuración' }, { status: 500 });
  }
}

// PUT /api/inventory/config - Save inventory sync configuration
export async function PUT(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { spreadsheetId, sheetName, range, columnMap, syncInterval, isActive } = body;

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'spreadsheetId es requerido' },
        { status: 400 }
      );
    }

    const existing = await db.inventorySyncConfig.findFirst({
      where: { userId: authResult.userId },
    });

    let config;
    if (existing) {
      config = await db.inventorySyncConfig.update({
        where: { id: existing.id },
        data: {
          spreadsheetId,
          sheetName: sheetName ?? existing.sheetName,
          range: range ?? existing.range,
          columnMap: columnMap ? JSON.stringify(columnMap) : existing.columnMap,
          syncInterval: syncInterval ?? existing.syncInterval,
          isActive: isActive ?? existing.isActive,
        },
      });
    } else {
      config = await db.inventorySyncConfig.create({
        data: {
          userId: authResult.userId,
          spreadsheetId,
          sheetName: sheetName ?? 'Inventario',
          range: range ?? 'A1:Z1000',
          columnMap: columnMap ? JSON.stringify(columnMap) : null,
          syncInterval: syncInterval ?? 60,
          isActive: isActive ?? false,
        },
      });
    }

    return NextResponse.json({ success: true, config: { id: config.id, isActive: config.isActive } });
  } catch (error) {
    console.error('Save inventory config error:', error);
    return NextResponse.json({ error: 'Error al guardar configuración' }, { status: 500 });
  }
}
