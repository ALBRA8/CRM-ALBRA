import type { NextRequest } from 'next/server'
import { requireAuth, HttpError } from '@/lib/auth'
import { handle, json, readBody } from '../_lib/shared'
import { issueDownloadTicket } from '@/lib/download-tickets'

/**
 * POST /api/download-ticket — emite un ticket de descarga de UN SOLO USO y
 * 60 s de vida a nombre de la sesión autenticada (reparación integral 2026-11-06).
 * Reemplaza el paso de JWT por la URL (?token=) para descargas directas
 * (CSV/PDF/backup): el enlace se construye con `?ticket=...` y el ticket se
 * canjea una sola vez en el endpoint de descarga. Nunca queda un JWT en URL,
 * historial ni Referer.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    await readBody(req).catch(() => ({ ok: true as const, body: '{}' }))
    try {
      const { ticket, expiresInSec } = issueDownloadTicket(auth)
      return json({ ticket, expiresInSec, usage: 'Añade ?ticket=<valor> a la URL de descarga; el ticket se consume en el primer uso.' })
    } catch (e) {
      throw new HttpError(429, e instanceof Error ? e.message : 'No se pudo emitir el ticket')
    }
  })
}
