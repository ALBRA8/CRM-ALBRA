import { db } from './db'
import { HttpError } from './auth'
import { llmChat, extractJson } from './ai'
import { buildNichoContext } from './integrations'
import { buildKnowledgeContext } from './knowledge'
import { parseOppMeta } from '../app/api/_lib/opportunities'
import { loadClientAttrs } from '../app/api/_lib/clients'

/**
 * IA de cierre (Fase 4): analiza una oportunidad del pipeline y devuelve una
 * sugerencia estructurada — probabilidad de cierre, siguiente mejor acción,
 * mensaje sugerido para el cliente y el razonamiento de la IA.
 *
 * Patrón (canal-agent.ts): llmChat con jsonMode + extractJson fail-closed,
 * errores como HttpError con status claro (404/403/503/502), nunca 500 críptico.
 * Las funciones puras (buildDealContext, buildDealMessages, parseDealSuggestion)
 * viven aquí para poder testearlas sin BD ni proveedor LLM.
 */

export interface DealSuggestion {
  /** Probabilidad de cierre sugerida por la IA (0–100, entero). */
  probability: number
  /** Siguiente mejor acción comercial, breve y concreta. */
  nextBestAction: string
  /** Mensaje listo para enviar al cliente (WhatsApp/email). */
  suggestedMessage: string
  /** Razonamiento breve: por qué la IA sugiere esto. */
  reasoning: string
}

/** Contexto serializable de la oportunidad — insumo del prompt. */
export interface DealContext {
  title: string
  amount: number
  currency: string
  status: string
  stageName: string | null
  stageProbability: number | null
  currentProbability: number
  expectedCloseDate: string | null
  clientName: string | null
  clientTemperature: string | null
  lastContactAt: string | null
  interest: string | null
  currentNextAction: string | null
  notes: string | null
  source: string | null
  quotes: Array<{ status: string; total: number; currency: string; createdAt: string }>
  recentTimeline: Array<{ type: string; title: string; createdAt: string }>
}

const DEAL_SYSTEM_PROMPT = `Eres un asistente experto en ventas B2B que ayuda a vendedores a cerrar sus oportunidades en un CRM. Analizas el contexto de una oportunidad (etapa del pipeline, valor, cliente, historial reciente, cotizaciones) y devuelves una recomendación de cierre.

Responde SIEMPRE en español y SOLO con un objeto JSON válido (sin texto adicional) con exactamente estas claves:
{
  "probability": <número entero 0-100 con la probabilidad de cierre estimada>,
  "nextBestAction": "<acción concreta siguiente (máx 1-2 oraciones)>",
  "suggestedMessage": "<mensaje breve y profesional listo para enviarle al cliente por WhatsApp o email>",
  "reasoning": "<por qué sugieres esto, en 1-2 oraciones>"
}

Reglas: sé realista con la probabilidad (considera etapa, antigüedad sin contacto, cotizaciones y señales del historial). El mensaje sugerido debe sonar humano, en el tono del negocio, y empujar la oportunidad hacia el cierre sin ser agresivo.`

/** Construye el contexto serializable desde el registro Prisma de la oportunidad. */
export function buildDealContext(
  opp: {
    title: string
    amount: number
    currency: string
    status: string
    probability: number | null
    expectedCloseDate: Date | null
    source: string | null
    notes: string | null
    stage?: { name: string; probability: number } | null
    client?: { name: string; lastContactAt: Date | null; createdAt: Date } | null
  },
  extras: {
    temperature?: string | null
    quotes?: Array<{ status: string; total: number; currency: string; createdAt: Date }>
    timeline?: Array<{ type: string; title: string; createdAt: Date }>
  } = {}
): DealContext {
  const meta = parseOppMeta(opp.notes)
  return {
    title: opp.title,
    amount: opp.amount,
    currency: opp.currency,
    status: opp.status,
    stageName: opp.stage?.name ?? null,
    stageProbability: opp.stage ? Math.round(opp.stage.probability * 100) : null,
    currentProbability: opp.probability ?? (opp.stage ? Math.round(opp.stage.probability * 100) : 50),
    expectedCloseDate: opp.expectedCloseDate ? opp.expectedCloseDate.toISOString() : null,
    clientName: opp.client?.name ?? null,
    clientTemperature: extras.temperature ?? null,
    lastContactAt: opp.client?.lastContactAt ? opp.client.lastContactAt.toISOString() : null,
    interest: meta.interest,
    currentNextAction: meta.nextAction,
    notes: meta.text,
    source: opp.source,
    quotes: (extras.quotes ?? []).map((q) => ({
      status: q.status,
      total: q.total,
      currency: q.currency,
      createdAt: q.createdAt.toISOString(),
    })),
    recentTimeline: (extras.timeline ?? []).map((t) => ({
      type: t.type,
      title: t.title,
      createdAt: t.createdAt.toISOString(),
    })),
  }
}

/** Arma los mensajes del prompt (system + user) a partir del contexto. */
export function buildDealMessages(ctx: DealContext): Array<{ role: 'system' | 'user'; content: string }> {
  const lines: string[] = [
    `OPORTUNIDAD: ${ctx.title}`,
    `Valor: ${ctx.currency} ${ctx.amount}`,
    `Estado: ${ctx.status}`,
    `Etapa: ${ctx.stageName ?? 'sin etapa'} (probabilidad base de etapa: ${ctx.stageProbability ?? 'n/a'}%)`,
    `Probabilidad actual registrada: ${ctx.currentProbability}%`,
    `Fecha esperada de cierre: ${ctx.expectedCloseDate ?? 'no definida'}`,
  ]
  if (ctx.clientName) lines.push(`Cliente: ${ctx.clientName}`)
  if (ctx.clientTemperature) lines.push(`Temperatura del cliente: ${ctx.clientTemperature}`)
  if (ctx.lastContactAt) lines.push(`Último contacto: ${ctx.lastContactAt}`)
  if (ctx.interest) lines.push(`Interés declarado: ${ctx.interest}`)
  if (ctx.currentNextAction) lines.push(`Próxima acción ya registrada: ${ctx.currentNextAction}`)
  if (ctx.notes) lines.push(`Notas: ${ctx.notes}`)
  if (ctx.source) lines.push(`Origen: ${ctx.source}`)
  if (ctx.quotes.length > 0) {
    lines.push('Cotizaciones:')
    for (const q of ctx.quotes) lines.push(`  - ${q.status} · ${q.currency} ${q.total} · ${q.createdAt}`)
  }
  if (ctx.recentTimeline.length > 0) {
    lines.push('Historial reciente (más nuevo primero):')
    for (const t of ctx.recentTimeline) lines.push(`  - [${t.type}] ${t.title} · ${t.createdAt}`)
  }
  return [
    { role: 'system', content: DEAL_SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ]
}

/** Valida y normaliza la respuesta del LLM hacia un DealSuggestion (fail-closed). */
export function parseDealSuggestion(raw: string): DealSuggestion {
  const parsed = extractJson<Partial<Record<keyof DealSuggestion, unknown>>>(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(502, 'La IA no devolvió un formato válido. Inténtalo de nuevo.')
  }
  const probabilityRaw = parsed.probability
  const probNum = typeof probabilityRaw === 'number' ? probabilityRaw : parseFloat(String(probabilityRaw ?? NaN))
  if (!Number.isFinite(probNum)) {
    throw new HttpError(502, 'La IA no devolvió una probabilidad válida. Inténtalo de nuevo.')
  }
  // Clamp 0-100 + redondeo: la IA a veces responde 0.85 (fracción) o 105.
  // Heurística: una fracción estricta entre 0 y 1 se interpreta como porcentaje (0.85 → 85).
  const normalized = probNum > 0 && probNum < 1 ? probNum * 100 : probNum
  const probability = Math.round(Math.min(100, Math.max(0, normalized)))
  const strField = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v.trim() : '')
  const nextBestAction = strField(parsed.nextBestAction)
  const suggestedMessage = strField(parsed.suggestedMessage)
  if (!nextBestAction && !suggestedMessage) {
    throw new HttpError(502, 'La IA no devolvió una acción o mensaje útil. Inténtalo de nuevo.')
  }
  return {
    probability,
    nextBestAction,
    suggestedMessage,
    reasoning: strField(parsed.reasoning),
  }
}

/**
 * Genera la sugerencia de cierre para una oportunidad (scope por organización).
 * Lanza HttpError: 404 (no encontrada), 403 (IA desactivada), 503 (sin proveedor), 502 (respuesta inválida).
 */
export async function suggestDealClose(orgId: string, opportunityId: string): Promise<DealSuggestion> {
  const settings = await db.settings.findUnique({
    where: { organizationId: orgId },
    select: { dealAiEnabled: true },
  })
  if (settings && settings.dealAiEnabled === false) {
    throw new HttpError(403, 'La IA de cierre está desactivada para esta organización (Configuración).')
  }

  const opp = await db.opportunity.findFirst({
    where: { id: opportunityId, organizationId: orgId },
    include: {
      stage: true,
      client: { select: { id: true, name: true, lastContactAt: true, createdAt: true } },
    },
  })
  if (!opp) throw new HttpError(404, 'Oportunidad no encontrada')

  const [attrsMap, quotes, timeline, nichoContext, knowledgeContext] = await Promise.all([
    opp.client ? loadClientAttrs(orgId, [opp.client.id]) : Promise.resolve(new Map()),
    db.quote.findMany({
      where: { opportunityId: opp.id },
      select: { status: true, total: true, currency: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    db.timelineEvent.findMany({
      where: { organizationId: orgId, opportunityId: opp.id },
      select: { type: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    buildNichoContext(orgId),
    buildKnowledgeContext(orgId),
  ])

  const temperature = attrsMap.get(opp.client?.id ?? '')?.temperature ?? null
  const ctx = buildDealContext(opp, { temperature, quotes, timeline })

  const messages = buildDealMessages(ctx)
  // El nicho y el conocimiento del negocio dan tono y hechos al mensaje sugerido.
  if (nichoContext) messages.push({ role: 'system', content: nichoContext })
  if (knowledgeContext) messages.push({ role: 'system', content: knowledgeContext })

  let raw: string
  try {
    raw = await llmChat(orgId, messages, { jsonMode: true, temperature: 0.3 })
  } catch (err) {
    // Sin proveedor LLM configurado → 503 con el mensaje claro de src/lib/ai.ts.
    throw new HttpError(503, err instanceof Error ? err.message : 'No hay proveedor de IA disponible.')
  }
  return parseDealSuggestion(raw)
}
