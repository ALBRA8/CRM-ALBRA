import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { suggestDealClose } from '@/lib/deal-ai'

/**
 * POST /api/opportunities/:id/ai-suggest — IA de cierre (Fase 4).
 * Genera una sugerencia para la oportunidad: probabilidad de cierre, siguiente
 * mejor acción, mensaje sugerido y razonamiento. Solo lectura: NO muta la
 * oportunidad (aplicar la sugerencia se hace vía PUT /api/opportunities/:id).
 *
 * Errores: 401 sin sesión · 404 fuera de la org · 403 IA desactivada ·
 * 503 sin proveedor LLM · 502 respuesta inválida del LLM.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const suggestion = await suggestDealClose(auth.orgId, id)
    return json({ suggestion })
  })
}
