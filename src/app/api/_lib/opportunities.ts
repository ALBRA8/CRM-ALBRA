import type { PipelineStage } from '@prisma/client'
import { parseJson, str } from './shared'
import { computeTemperature, type ClientAttrs, serializeClientRef } from './clients'

/**
 * Oportunidades: los campos del frontend que no tienen columna (interest,
 * nextAction, nextActionDate) se guardan como envelope JSON en `notes`.
 * `{ text, interest, nextAction, nextActionDate }`.
 */

export interface OpportunityMeta {
  text: string | null
  interest: string | null
  nextAction: string | null
  nextActionDate: string | null
}

export function parseOppMeta(notes: string | null): OpportunityMeta {
  const parsed = parseJson<Partial<OpportunityMeta>>(notes, {})
  // Si notes era texto plano (no JSON), consérvalo como text.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      text: parsed.text ?? null,
      interest: parsed.interest ?? null,
      nextAction: parsed.nextAction ?? null,
      nextActionDate: parsed.nextActionDate ?? null,
    }
  }
  return { text: notes, interest: null, nextAction: null, nextActionDate: null }
}

export function buildOppMeta(body: Record<string, unknown>, previous?: OpportunityMeta): string {
  const meta: OpportunityMeta = {
    text: 'notes' in body ? str(body.notes) : (previous?.text ?? null),
    interest: 'interest' in body ? str(body.interest) : (previous?.interest ?? null),
    nextAction: 'nextAction' in body ? str(body.nextAction) : (previous?.nextAction ?? null),
    nextActionDate: 'nextActionDate' in body ? (str(body.nextActionDate) ?? previous?.nextActionDate ?? null) : (previous?.nextActionDate ?? null),
  }
  return JSON.stringify(meta)
}

interface OppRecordLike {
  id: string
  title: string
  clientId: string | null
  stageId: string | null
  amount: number
  currency: string
  probability: number | null
  expectedCloseDate: Date | null
  status: string
  closedAt: Date | null
  notes: string | null
  source: string | null
  createdAt: Date
  updatedAt: Date
  stage?: PipelineStage | null
  client?: { id: string; name: string; email: string | null; phone: string | null; lastContactAt: Date | null; createdAt: Date } | null
}

export function serializeOpportunity(
  opp: OppRecordLike,
  clientAttrs?: ClientAttrs
): Record<string, unknown> {
  const meta = parseOppMeta(opp.notes)
  const stage = opp.stage ?? null
  return {
    id: opp.id,
    title: opp.title,
    interest: meta.interest ?? '',
    estimatedValue: opp.amount,
    amount: opp.amount,
    currency: opp.currency,
    probability: opp.probability ?? (stage ? Math.round(stage.probability * 100) : 50),
    status: opp.status,
    stage: stage ? { id: stage.id, name: stage.name, color: stage.color, order: stage.order, isWon: stage.isWon, isLost: stage.isLost } : null,
    stageId: opp.stageId,
    client: opp.client
      ? {
          ...serializeClientRef(opp.client, clientAttrs),
          temperature: clientAttrs?.temperature || (opp.client ? computeTemperature(opp.client.lastContactAt, opp.client.createdAt) : 'Frio'),
        }
      : null,
    clientId: opp.clientId,
    nextAction: meta.nextAction,
    nextActionDate: meta.nextActionDate,
    expectedCloseDate: opp.expectedCloseDate,
    closedAt: opp.closedAt,
    notes: meta.text,
    source: opp.source,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
  }
}

/** Extrae estimatedValue/amount del body del frontend. */
export function oppAmountFrom(body: Record<string, unknown>): number {
  const v = body.estimatedValue !== undefined ? body.estimatedValue : body.amount
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}
