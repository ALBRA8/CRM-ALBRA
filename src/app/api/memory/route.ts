import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, parseIntParam, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * GET  /api/memory?clientId= — memorias del agente de la organización
 * POST /api/memory          — crea una memoria ({ content, clientId?, key?, source?, importance? })
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const clientId = new URL(req.url).searchParams.get('clientId') || undefined
    const limit = parseIntParam(req, 'limit', 100, 1, 200)
    const memories = await db.agentMemory.findMany({
      where: { organizationId: auth.orgId, ...(clientId ? { clientId } : {}) },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    })
    return json({ memories })
  })
}

interface MemoryBody {
  clientId?: string | null
  key?: string | null
  content?: string
  source?: string
  importance?: number
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as MemoryBody
    requireFields(body as unknown as Record<string, unknown>, ['content'])
    const content = String(body.content).slice(0, 4000)

    // Aislamiento multi-tenant: el clientId (si viene) debe pertenecer a la org
    if (body.clientId) {
      const client = await db.client.findFirst({ where: { id: body.clientId, organizationId: auth.orgId }, select: { id: true } })
      if (!client) return json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    const importance = Number(body.importance ?? 1)
    const memory = await db.agentMemory.create({
      data: {
        organizationId: auth.orgId,
        clientId: body.clientId || null,
        key: body.key || null,
        content,
        source: body.source === 'agent' || body.source === 'conversation' ? body.source : 'manual',
        importance: Number.isFinite(importance) ? Math.min(5, Math.max(1, Math.round(importance))) : 1,
      },
    })
    return json({ memory }, { status: 201 })
  })
}
