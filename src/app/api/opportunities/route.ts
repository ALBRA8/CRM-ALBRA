import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, requireFields, str, dateOrNull, numOrNull, qparam } from '../_lib/shared'
import { loadClientAttrs } from '../_lib/clients'
import { buildOppMeta, oppAmountFrom, serializeOpportunity } from '../_lib/opportunities'

/** GET /api/opportunities — listado con client y stage incluidos. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const clientId = qparam(req, 'clientId')
    const status = qparam(req, 'status')
    const stageId = qparam(req, 'stageId')
    const search = qparam(req, 'search') ?? qparam(req, 'q')
    const limit = Math.min(parseIntQ(req, 'limit') ?? 200, 500)

    const opportunities = await db.opportunity.findMany({
      where: {
        organizationId: auth.orgId,
        ...(clientId ? { clientId } : {}),
        ...(status ? { status } : {}),
        ...(stageId ? { stageId } : {}),
        ...(search ? { title: { contains: search } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        stage: true,
        client: { select: { id: true, name: true, email: true, phone: true, lastContactAt: true, createdAt: true } },
      },
    })

    const attrsMap = await loadClientAttrs(auth.orgId, opportunities.map((o) => o.client?.id).filter((x): x is string => Boolean(x)))
    return json({ opportunities: opportunities.map((o) => serializeOpportunity(o, o.client ? attrsMap.get(o.client.id) : undefined)) })
  })
}

function parseIntQ(req: NextRequest, name: string): number | null {
  const raw = qparam(req, name)
  if (!raw) return null
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? null : n
}

/** POST /api/opportunities — { clientId, title, estimatedValue, probability, stageId, ... } */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['title'])

    // Valida cliente y etapa contra la organización
    let clientId = str(body.clientId)
    if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: auth.orgId }, select: { id: true } })
      if (!client) throw new HttpError(400, 'Cliente no encontrado')
    } else {
      clientId = null
    }
    let stageId = str(body.stageId)
    if (stageId) {
      const stage = await db.pipelineStage.findFirst({ where: { id: stageId, organizationId: auth.orgId } })
      if (!stage) stageId = null
    }
    let stage = stageId
      ? await db.pipelineStage.findFirst({ where: { id: stageId, organizationId: auth.orgId } })
      : await db.pipelineStage.findFirst({ where: { organizationId: auth.orgId }, orderBy: { order: 'asc' } })
    stageId = stage?.id ?? null

    const probability = numOrNull(body.probability) ?? (stage ? Math.round(stage.probability * 100) : 50)

    const created = await db.opportunity.create({
      data: {
        organizationId: auth.orgId,
        title: str(body.title) as string,
        clientId,
        stageId,
        amount: oppAmountFrom(body),
        probability,
        status: 'open',
        notes: buildOppMeta(body),
        source: str(body.source) ?? 'manual',
        expectedCloseDate: dateOrNull(body.expectedCloseDate),
        assignedToId: str(body.assignedToId),
        createdById: auth.userId,
      },
      include: {
        stage: true,
        client: { select: { id: true, name: true, email: true, phone: true, lastContactAt: true, createdAt: true } },
      },
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'opportunity',
      entityId: created.id,
      details: { name: created.title, amount: created.amount },
      clientId,
      opportunityId: created.id,
      timelineType: 'system',
      timelineTitle: `Nueva oportunidad: ${created.title}`,
    })

    const attrs = clientId ? (await loadClientAttrs(auth.orgId, [clientId])).get(clientId) : undefined
    return json({ opportunity: serializeOpportunity(created, attrs) }, { status: 201 })
  })
}
