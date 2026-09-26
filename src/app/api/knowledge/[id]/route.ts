import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, auditAndTimeline } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * Base de conocimiento del Agente IA por organización.
 * GET    /api/knowledge/:id
 * PUT    /api/knowledge/:id — { title?, content?, category?, isActive? }
 * DELETE /api/knowledge/:id
 */

const KNOWLEDGE_CATEGORIES = ['general', 'catalogo', 'terminos', 'faq', 'politicas'] as const

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const entry = await db.knowledge.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!entry) return json({ error: 'Entrada de conocimiento no encontrada' }, { status: 404 })
    return json({ knowledge: entry })
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.knowledge.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!existing) return json({ error: 'Entrada de conocimiento no encontrada' }, { status: 404 })
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const data: Record<string, unknown> = {}
    if ('title' in body) {
      const title = String(body.title ?? '').trim()
      if (!title) return json({ error: 'title no puede estar vacío' }, { status: 400 })
      data.title = title.slice(0, 120)
    }
    if ('content' in body) {
      const content = String(body.content ?? '').trim()
      if (!content) return json({ error: 'content no puede estar vacío' }, { status: 400 })
      data.content = content.slice(0, 8000)
    }
    if ('category' in body) {
      const category = String(body.category)
      if (!KNOWLEDGE_CATEGORIES.includes(category as (typeof KNOWLEDGE_CATEGORIES)[number])) {
        return json({ error: `category inválida. Válidas: ${KNOWLEDGE_CATEGORIES.join(', ')}` }, { status: 400 })
      }
      data.category = category
    }
    if ('isActive' in body) data.isActive = Boolean(body.isActive)

    const entry = await db.knowledge.update({ where: { id }, data })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'knowledge',
      entityId: entry.id,
      details: { name: entry.title, fields: Object.keys(data).slice(0, 10) },
    })

    return json({ knowledge: entry })
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.knowledge.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, title: true } })
    if (!existing) return json({ error: 'Entrada de conocimiento no encontrada' }, { status: 404 })

    await db.knowledge.delete({ where: { id } })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'deleted',
      entity: 'knowledge',
      entityId: id,
      details: { name: existing.title },
    })
    return json({ success: true })
  })
}
