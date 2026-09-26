import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { getAccessToken, googleApi } from '@/lib/google'

/**
 * POST /api/google/sheets/read — lee un rango de Google Sheets.
 * Body: { spreadsheetId, range? } (range default: A1:Z1000).
 * Graceful: sin conexión → 400 descriptivo; API caída → { rows: [] }.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { spreadsheetId?: string; range?: string }
    requireFields(body as unknown as Record<string, unknown>, ['spreadsheetId'])
    const spreadsheetId = String(body.spreadsheetId).trim()
    const range = String(body.range || 'A1:Z1000').trim()

    const accessToken = await getAccessToken(auth.orgId)
    if (!accessToken) {
      return json({ error: 'Google no conectado. Conecta tu cuenta en Configuración → Google para leer Sheets.' }, { status: 400 })
    }

    const data = await googleApi<{ values?: string[][] }>(
      accessToken,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
    )
    if (!data) return json({ connected: true, rows: [], note: 'Sheets API no disponible o rango inválido' })

    return json({ connected: true, range, rows: data.values || [] })
  })
}
