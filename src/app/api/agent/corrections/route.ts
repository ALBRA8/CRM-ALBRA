import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { rememberCorrection } from '@/lib/memory'

/**
 * POST /api/agent/corrections — auto-mejora del agente (patrón self-improving).
 * Guarda el par original→final cuando el vendedor edita un mensaje sugerido
 * por la IA antes de enviarlo. La lección se inyecta como few-shot en
 * sugerencias futuras (recallStyleLessons).
 * Body: { original, final, clientId?, channel? }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as {
      original?: string
      final?: string
      clientId?: string | null
      channel?: string | null
    }
    requireFields(body as unknown as Record<string, unknown>, ['original', 'final'])

    // Aislamiento multi-tenant: el clientId (si viene) debe pertenecer a la org
    if (body.clientId) {
      const client = await db.client.findFirst({
        where: { id: body.clientId, organizationId: auth.orgId },
        select: { id: true },
      })
      if (!client) return json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    await rememberCorrection({
      orgId: auth.orgId,
      clientId: body.clientId || null,
      original: String(body.original),
      final: String(body.final),
      channel: body.channel || null,
    })
    return json({ success: true }, { status: 201 })
  })
}
