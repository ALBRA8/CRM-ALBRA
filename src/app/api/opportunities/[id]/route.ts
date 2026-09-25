import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { recordTimelineEvent } from '@/lib/timeline'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { handle, json, readBody, str, numOrNull } from '../../_lib/shared'
import { loadClientAttrs } from '../../_lib/clients'
import { buildOppMeta, oppAmountFrom, parseOppMeta, serializeOpportunity } from '../../_lib/opportunities'

/** GET /api/opportunities/:id */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const opp = await db.opportunity.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        stage: true,
        client: { select: { id: true, name: true, email: true, phone: true, lastContactAt: true, createdAt: true } },
      },
    })
    if (!opp) throw new HttpError(404, 'Oportunidad no encontrada')

    const attrs = opp.client ? (await loadClientAttrs(auth.orgId, [opp.client.id])).get(opp.client.id) : undefined
    return json({ opportunity: serializeOpportunity(opp, attrs) })
  })
}

/**
 * PUT /api/opportunities/:id — actualización parcial. Si cambia stageId:
 * timeline stage_change + trigger opportunity_stage_changed; si la etapa
 * destino isWon → status=won + Transaction income + timeline; si isLost → lost.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const existing = await db.opportunity.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { stage: true },
    })
    if (!existing) throw new HttpError(404, 'Oportunidad no encontrada')
    const body = await readBody(req)

    // Campos simples
    const data: Record<string, unknown> = {}
    if ('title' in body) data.title = str(body.title) ?? existing.title
    if ('estimatedValue' in body || 'amount' in body) data.amount = oppAmountFrom(body)
    if ('probability' in body) data.probability = numOrNull(body.probability)
    if ('expectedCloseDate' in body) data.expectedCloseDate = str(body.expectedCloseDate) ? new Date(str(body.expectedCloseDate) as string) : null
    if ('source' in body) data.source = str(body.source)
    if ('clientId' in body) {
      const clientId = str(body.clientId)
      if (clientId) {
        const client = await db.client.findFirst({ where: { id: clientId, organizationId: auth.orgId }, select: { id: true } })
        if (!client) throw new HttpError(400, 'Cliente no encontrado')
      }
      data.clientId = clientId
    }

    // Cambio de etapa
    let newStage = existing.stage
    const requestedStageId = str(body.stageId)
    if (requestedStageId && requestedStageId !== existing.stageId) {
      const stage = await db.pipelineStage.findFirst({ where: { id: requestedStageId, organizationId: auth.orgId } })
      if (!stage) throw new HttpError(400, 'Etapa no válida')
      newStage = stage
      data.stageId = stage.id
    }

    const finalAmount = data.amount !== undefined ? (data.amount as number) : existing.amount
    const finalTitle = data.title !== undefined ? (data.title as string) : existing.title

    let stageChanged = false
    if (newStage && newStage.id !== (existing.stage?.id ?? null)) {
      stageChanged = true
      const fromName = existing.stage?.name ?? 'Sin etapa'
      const toName = newStage.name

      if (newStage.isWon && existing.status !== 'won') {
        data.status = 'won'
        data.closedAt = new Date()
      } else if (newStage.isLost && existing.status !== 'lost') {
        data.status = 'lost'
        data.closedAt = new Date()
      }

      await auditAndTimeline({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'stage_changed',
        entity: 'opportunity',
        entityId: id,
        details: { name: finalTitle, from: fromName, to: toName },
        clientId: existing.clientId,
        opportunityId: id,
        timelineType: 'stage_change',
        timelineTitle: `Etapa: ${fromName} → ${toName}`,
        timelineDescription: finalTitle,
      })
      await runWorkflowsForTrigger({
        orgId: auth.orgId,
        type: 'opportunity_stage_changed',
        payload: {
          opportunityId: id,
          clientId: existing.clientId,
          fromStage: fromName,
          toStage: toName,
          title: finalTitle,
          amount: finalAmount,
        },
      })
    } else if (Object.keys(data).length > 0) {
      await auditAndTimeline({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'updated',
        entity: 'opportunity',
        entityId: id,
        details: { name: finalTitle, fields: Object.keys(body).slice(0, 10) },
        clientId: existing.clientId,
        opportunityId: id,
      })
    }

    // Notas envelope (interest/nextAction/nextActionDate/notes)
    if ('interest' in body || 'nextAction' in body || 'nextActionDate' in body || 'notes' in body) {
      data.notes = buildOppMeta(body, parseOppMeta(existing.notes))
    }

    const updated = await db.opportunity.update({
      where: { id },
      data,
      include: {
        stage: true,
        client: { select: { id: true, name: true, email: true, phone: true, lastContactAt: true, createdAt: true } },
      },
    })

    // Oportunidad ganada → Transaction income automática
    if (stageChanged && newStage && newStage.isWon && updated.status === 'won' && existing.status !== 'won' && updated.amount > 0) {
      const tx = await db.transaction.create({
        data: {
          organizationId: auth.orgId,
          type: 'ingreso',
          category: 'venta',
          description: `Cierre de oportunidad: ${updated.title}`,
          amount: updated.amount,
          currency: updated.currency,
          clientId: updated.clientId,
          date: new Date(),
        },
      })
      await recordTimelineEvent({
        orgId: auth.orgId,
        clientId: updated.clientId,
        opportunityId: id,
        type: 'transaction',
        title: `Ingreso registrado (${updated.currency} ${updated.amount})`,
        description: `Oportunidad ganada: ${updated.title}`,
        source: 'system',
        userId: auth.userId,
        metadata: { transactionId: tx.id },
      })
    }

    const attrs = updated.client ? (await loadClientAttrs(auth.orgId, [updated.client.id])).get(updated.client.id) : undefined
    return json({ opportunity: serializeOpportunity(updated, attrs) })
  })
}
