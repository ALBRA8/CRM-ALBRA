import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, parseIntParam } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { embedTexts, cosine, parseVector, consolidateMemory } from '@/lib/memory'

/**
 * GET  /api/memory/vector?q=&clientId=&k= — stats de la memoria vectorial y,
 *      si viene `q`, búsqueda semántica sobre conversaciones y hechos.
 * POST /api/memory/vector  { clientId? } — consolida ahora los fragmentos
 *      pendientes en hechos duraderos (botón "Consolidar memoria" en Ajustes).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const q = new URL(req.url).searchParams.get('q') || ''
    const clientId = new URL(req.url).searchParams.get('clientId') || undefined
    const k = parseIntParam(req, 'k', 6, 1, 12)

    const [fragments, withVectors, facts, corrections, pendingCount] = await Promise.all([
      db.conversationEmbedding.count({ where: { organizationId: auth.orgId } }),
      db.conversationEmbedding.count({ where: { organizationId: auth.orgId, embedding: { not: null } } }),
      db.agentMemory.count({ where: { organizationId: auth.orgId, source: 'agent' } }),
      db.agentCorrection.count({ where: { organizationId: auth.orgId } }),
      db.conversationEmbedding.count({ where: { organizationId: auth.orgId, consolidated: false } }),
    ])
    const stats = {
      fragments,
      withVectors,
      facts,
      corrections,
      pendingConsolidation: pendingCount,
      vectorMode: fragments > 0 && withVectors > 0,
    }

    if (!q.trim()) return json({ stats, results: [] })

    // Búsqueda semántica sobre fragmentos + hechos (lo que el agente "recuerda").
    const [fragRows, factRows, qVec] = await Promise.all([
      db.conversationEmbedding.findMany({
        where: { organizationId: auth.orgId, ...(clientId ? { clientId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: { id: true, text: true, channel: true, role: true, embedding: true, createdAt: true },
      }),
      db.agentMemory.findMany({
        where: { organizationId: auth.orgId, ...(clientId ? { clientId } : {}), embedding: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, content: true, embedding: true, createdAt: true },
      }),
      embedTexts(auth.orgId, [q.trim()], 'query'),
    ])

    if (!qVec || !qVec[0]) {
      // Modo degradado: sin embeddings configurados, devolvemos por recencia.
      const recent = fragRows.slice(0, k).map((r) => ({
        kind: 'conversation' as const,
        text: r.text,
        channel: r.channel,
        createdAt: r.createdAt.toISOString(),
        score: null as number | null,
      }))
      return json({ stats, results: recent, degraded: true })
    }

    const scored = [
      ...fragRows.map((r) => ({
        kind: 'conversation' as const,
        text: r.text,
        channel: r.channel,
        createdAt: r.createdAt.toISOString(),
        score: r.embedding ? cosine(qVec[0], parseVector(r.embedding) ?? []) : null,
      })),
      ...factRows.map((r) => ({
        kind: 'fact' as const,
        text: r.content,
        channel: 'memoria',
        createdAt: r.createdAt.toISOString(),
        score: r.embedding ? cosine(qVec[0], parseVector(r.embedding) ?? []) : null,
      })),
    ]
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, k)

    return json({ stats, results: scored })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { clientId?: string | null }
    if (body.clientId) {
      const client = await db.client.findFirst({
        where: { id: body.clientId, organizationId: auth.orgId },
        select: { id: true },
      })
      if (!client) return json({ error: 'Cliente no encontrado' }, { status: 404 })
    }
    const created = await consolidateMemory({ orgId: auth.orgId, clientId: body.clientId || null })
    return json({ success: true, newFacts: created })
  })
}
