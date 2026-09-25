import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, auditAndTimeline } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * Base de conocimiento del Agente IA por organización.
 * GET  /api/knowledge — { knowledge }
 * POST /api/knowledge — { title, content, category?, isActive? }
 */

const KNOWLEDGE_CATEGORIES = ['general', 'catalogo', 'terminos', 'faq', 'politicas'] as const

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const category = new URL(req.url).searchParams.get('category') || undefined
    const knowledge = await db.knowledge.findMany({
      where: { organizationId: auth.orgId, ...(category ? { category } : {}) },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    })
    return json({ knowledge })
  })
}

interface KnowledgeBody {
  title?: string
  content?: string
  category?: string
  isActive?: boolean
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as KnowledgeBody
    const title = String(body.title ?? '').trim()
    const content = String(body.content ?? '').trim()
    if (!title) return json({ error: 'title es requerido' }, { status: 400 })
    if (!content) return json({ error: 'content es requerido' }, { status: 400 })

    const category = String(body.category || 'general')
    if (!KNOWLEDGE_CATEGORIES.includes(category as (typeof KNOWLEDGE_CATEGORIES)[number])) {
      return json({ error: `category inválida. Válidas: ${KNOWLEDGE_CATEGORIES.join(', ')}` }, { status: 400 })
    }

    const entry = await db.knowledge.create({
      data: {
        organizationId: auth.orgId,
        title: title.slice(0, 120),
        content: content.slice(0, 8000),
        category,
        isActive: body.isActive !== false,
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'knowledge',
      entityId: entry.id,
      details: { name: entry.title, category: entry.category },
    })

    return json({ knowledge: entry }, { status: 201 })
  })
}
