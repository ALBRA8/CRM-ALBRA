import type { NextRequest } from 'next/server'
import { requireAuth, signDownloadToken, DOWNLOAD_TOKEN_TTL_SECONDS } from '@/lib/auth'
import { handle, json } from '../../_lib/shared'

/**
 * POST /api/auth/download-token — emite un token de DESCARGA de corta vida.
 *
 * Reparación integral B1: el JWT de sesión (7 días) no debe viajar en URLs
 * (?token=) de descargas directas porque queda en historial del navegador,
 * logs de proxy y cabecera Referer. La sesión canjea aquí un download-token
 * con `purpose: 'download'` y 5 minutos de expiración, válido SOLO en los
 * endpoints de descarga (export/csv, reports/pdf, reports/excel, quotes/pdf).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const token = signDownloadToken({
      userId: auth.userId,
      orgId: auth.orgId,
      role: auth.role,
      email: auth.email,
      // B4: hereda la tokenVersion → un download-token también se revoca
      tokenVersion: auth.tokenVersion,
    })
    return json({ token, expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS })
  })
}
