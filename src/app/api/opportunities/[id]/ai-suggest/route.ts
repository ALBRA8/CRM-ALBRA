import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { suggestDealClose } from '@/lib/deal-ai'
import { listClientChannels } from '@/lib/inbox'

/**
 * POST /api/opportunities/:id/ai-suggest — IA de cierre (Fase 4).
 * Genera una sugerencia para la oportunidad: probabilidad de cierre, siguiente
 * mejor acción, mensaje sugerido y razonamiento. Solo lectura sobre la
 * oportunidad (aplicar la sugerencia se hace vía PUT /api/opportunities/:id).
 * Además devuelve `channels`: los canales con conversación activa del cliente
 * para que la UI ofrezca "Enviar por WhatsApp/Telegram/…" (el envío real va por
 * POST /api/inbox/send, misma trazabilidad que la bandeja).
 *
 * Errores: 401 sin sesión · 404 fuera de la org · 403 IA desactivada ·
 * 503 sin proveedor LLM · 502 respuesta inválida del LLM.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const suggestion = await suggestDealClose(auth.orgId, id)

    // Canales con conversación activa del cliente de la oportunidad (best-effort:
    // lista vacía si no tiene ninguno; la UI solo muestra botones de envío existentes).
    const oppRef = await db.opportunity.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { clientId: true },
    })
    const channels = oppRef?.clientId ? await listClientChannels(auth.orgId, oppRef.clientId) : []

    return json({ suggestion, channels })
  })
}
