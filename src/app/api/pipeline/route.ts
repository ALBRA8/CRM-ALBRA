import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '../_lib/shared'
import { loadClientAttrs } from '../_lib/clients'
import { serializeOpportunity } from '../_lib/opportunities'

/**
 * GET /api/pipeline — tablero kanban: etapas con oportunidades anidadas
 * (shape que consume pipeline-view.tsx) + lista plana y resumen.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)

    const [stages, opportunities] = await Promise.all([
      db.pipelineStage.findMany({ where: { organizationId: auth.orgId }, orderBy: { order: 'asc' } }),
      db.opportunity.findMany({
        where: { organizationId: auth.orgId },
        orderBy: { createdAt: 'desc' },
        include: {
          stage: true,
          client: { select: { id: true, name: true, email: true, phone: true, lastContactAt: true, createdAt: true } },
        },
      }),
    ])

    const clientIds = opportunities.map((o) => o.client?.id).filter((x): x is string => Boolean(x))
    const attrsMap = await loadClientAttrs(auth.orgId, clientIds)

    const serialized = opportunities.map((o) => {
      const s = serializeOpportunity(o, o.client ? attrsMap.get(o.client.id) : undefined)
      // El kanban renderiza opp.client siempre; garantiza placeholder si no hay cliente.
      if (!s.client) {
        s.client = { id: '', name: 'Sin cliente', email: null, phone: null, temperature: 'Frio' }
      }
      return s
    })

    const openOpps = serialized.filter((o) => o.status === 'open')
    const stageViews = stages.map((stage) => {
      const inStage = serialized.filter((o) => o.stageId === stage.id)
      const openInStage = inStage.filter((o) => o.status === 'open')
      const avgProbability = inStage.length > 0
        ? Math.round(inStage.reduce((s, o) => s + Number(o.probability ?? 0), 0) / inStage.length)
        : Math.round(stage.probability * 100)
      return {
        id: stage.id,
        name: stage.name,
        order: stage.order,
        color: stage.color,
        probability: Math.round(stage.probability * 100),
        opportunityCount: inStage.length,
        totalValue: inStage.reduce((s, o) => s + Number(o.estimatedValue ?? 0), 0),
        avgProbability,
        opportunities: inStage,
      }
    })

    return json({
      stages: stageViews,
      opportunities: serialized,
      summary: {
        totalStages: stageViews.length,
        totalOpportunities: serialized.length,
        totalPipelineValue: openOpps.reduce((s, o) => s + Number(o.estimatedValue ?? 0), 0),
        openCount: openOpps.length,
      },
    })
  })
}
