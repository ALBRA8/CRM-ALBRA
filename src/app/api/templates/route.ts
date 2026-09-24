import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'
import { serializeTemplate, normalizeVariables, TEMPLATE_CHANNELS } from '@/lib/templates'

/**
 * GET  /api/templates — { templates } (el frontend lee `content`, el schema guarda `body`)
 * POST /api/templates — { name, channel, subject, content, variables (array|null), category }
 */

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const channel = new URL(req.url).searchParams.get('channel') || undefined
    const templates = await db.template.findMany({
      where: { organizationId: auth.orgId, ...(channel ? { channel } : {}) },
      orderBy: { createdAt: 'desc' },
    })
    return json({ templates: templates.map(serializeTemplate) })
  })
}

interface TemplateBody {
  name?: string
  channel?: string
  subject?: string | null
  content?: string
  body?: string
  variables?: unknown
  category?: string
  isActive?: boolean
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as TemplateBody
    requireFields(body as unknown as Record<string, unknown>, ['name'])
    const content = String(body.content ?? body.body ?? '').trim()
    if (!content) return json({ error: 'content (cuerpo de la plantilla) es requerido' }, { status: 400 })

    const channel = String(body.channel || 'generic')
    if (!TEMPLATE_CHANNELS.includes(channel)) {
      return json({ error: `channel inválido. Válidos: ${TEMPLATE_CHANNELS.join(', ')}` }, { status: 400 })
    }

    const template = await db.template.create({
      data: {
        organizationId: auth.orgId,
        name: String(body.name).slice(0, 120),
        channel,
        subject: body.subject ? String(body.subject).slice(0, 200) : null,
        body: content.slice(0, 5000),
        variables: normalizeVariables(body.variables),
        category: String(body.category || 'seguimiento').slice(0, 60),
        isActive: body.isActive !== false,
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'template',
      entityId: template.id,
      details: { name: template.name, channel: template.channel },
    })

    return json({ template: serializeTemplate(template) }, { status: 201 })
  })
}
