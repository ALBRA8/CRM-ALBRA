import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';
import { refreshGoogleToken } from '../../config/route';

// POST /api/google/sheets/sync-inventory - Sync products/inventory from a Google Sheet into Service model
export async function POST(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const inventoryConfig = await db.inventorySyncConfig.findFirst({
      where: { userId: authResult.userId, isActive: true },
    });

    if (!inventoryConfig) {
      return NextResponse.json(
        { error: 'Configuración de inventario no encontrada o inactiva' },
        { status: 400 }
      );
    }

    const googleConfig = await db.googleConfig.findFirst({
      where: { userId: authResult.userId, isConnected: true },
    });

    if (!googleConfig || !googleConfig.accessToken) {
      return NextResponse.json(
        { error: 'Google no está conectado' },
        { status: 400 }
      );
    }

    let accessToken = googleConfig.accessToken;

    if (googleConfig.tokenExpiry && new Date(googleConfig.tokenExpiry) < new Date()) {
      if (!googleConfig.refreshToken) {
        return NextResponse.json({ error: 'Token expirado' }, { status: 401 });
      }
      const refreshed = await refreshGoogleToken({
        clientId: googleConfig.clientId,
        clientSecret: googleConfig.clientSecret,
        refreshToken: googleConfig.refreshToken,
      });
      if (!refreshed) {
        return NextResponse.json({ error: 'Error al refrescar token' }, { status: 401 });
      }
      accessToken = refreshed.access_token;
      await db.googleConfig.update({
        where: { id: googleConfig.id },
        data: {
          accessToken: refreshed.access_token,
          tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
        },
      });
    }

    // Read Google Sheet
    const range = `${inventoryConfig.sheetName}!${inventoryConfig.range}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${inventoryConfig.spreadsheetId}/values/${encodeURIComponent(range)}`;

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
    const rows = data.values ?? [];

    if (rows.length === 0) {
      return NextResponse.json({ success: true, summary: { created: 0, updated: 0, skipped: 0, errors: 0 } });
    }

    // Parse column map
    const defaultColumnMap = { name: 0, description: 1, category: 2, price: 3, duration: 4 };
    let columnMap = defaultColumnMap;
    if (inventoryConfig.columnMap) {
      try {
        columnMap = JSON.parse(inventoryConfig.columnMap);
      } catch {
        columnMap = defaultColumnMap;
      }
    }

    // First row is header, skip it
    const dataRows = rows.slice(1);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of dataRows) {
      try {
        const name = row[columnMap.name] ?? '';
        if (!name.trim()) {
          skipped++;
          continue;
        }

        const description = row[columnMap.description] ?? null;
        const category = row[columnMap.category] ?? null;
        const price = parseFloat(row[columnMap.price]) || 0;
        const duration = parseInt(row[columnMap.duration]) || 60;

        // Upsert by name + userId
        const existing = await db.service.findFirst({
          where: {
            userId: authResult.userId,
            name,
          },
        });

        if (existing) {
          await db.service.update({
            where: { id: existing.id },
            data: {
              description: description ?? existing.description,
              category: category ?? existing.category,
              price: price !== 0 ? price : existing.price,
              duration: duration !== 60 ? duration : existing.duration,
            },
          });
          updated++;
        } else {
          await db.service.create({
            data: {
              userId: authResult.userId,
              name,
              description,
              category,
              price,
              duration,
            },
          });
          created++;
        }
      } catch {
        errors++;
      }
    }

    // Update sync config
    const syncResult = { created, updated, skipped, errors, totalRows: dataRows.length };
    await db.inventorySyncConfig.update({
      where: { id: inventoryConfig.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncResult: JSON.stringify(syncResult),
      },
    });

    return NextResponse.json({ success: true, summary: syncResult });
  } catch (error) {
    console.error('Sync inventory error:', error);
    return NextResponse.json({ error: 'Error al sincronizar inventario' }, { status: 500 });
  }
}
