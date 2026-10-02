import { db } from './db'
import { getLLMConfig, llmChat, extractJson } from './ai'

/**
 * Memoria vectorial del agente (Fase 5 "hipocampo del arnés").
 *
 * Qué recuerda y cómo:
 * - Conversaciones: cada mensaje entrante/saliente se guarda como fragmento con
 *   su embedding (ConversationEmbedding). El recall es semántico (coseno) con
 *   ancla de recencia, aislado por organización y cliente.
 * - Hechos consolidados: periódicamente se resumen fragmentos nuevos en hechos
 *   duraderos (AgentMemory, source='agent') con deduplicación semántica.
 * - Lecciones de estilo (self-improving): cuando el vendedor edita un mensaje
 *   sugerido por la IA, se guarda el par original→final (AgentCorrection) y se
 *   inyecta como few-shot en sugerencias futuras.
 *
 * Contrato de robustez (nunca bloquear el camino del mensaje):
 * - Sin proveedor LLM o sin llmEmbedModel configurado → modo degradado a
 *   recencia (las funciones devuelven '', 0 o null; NUNCA lanzan).
 * - Fallo de red del proveedor de embeddings → degradación igual.
 * - Las funciones puras (cosine, parseVector, formatRecallBlock,
 *   formatStyleLessons) se exportan para testear sin BD ni red.
 */

/** Longitud máxima de texto por fragmento (los mensajes de mensajería son cortos). */
export const MAX_MEMORY_TEXT = 1500
/** Umbral de similitud para considerar dos hechos duplicados en la consolidación. */
export const DEDUP_SIMILARITY = 0.92
/** Fragmentos sin consolidar por cliente que disparan la consolidación automática. */
export const CONSOLIDATE_THRESHOLD = 8
/** Máximo de filas cargadas para el recall (coste O(n) en JS; sobra con creces). */
const RECALL_SCAN_LIMIT = 300

// ---------- Utilidades vectoriales (puras) ----------

/** Parsea el JSON de un vector guardado; tolerante a basura (devuelve null). */
export function parseVector(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const vec = parsed.map(Number)
    return vec.every((n) => Number.isFinite(n)) ? vec : null
  } catch {
    return null
  }
}

/** Similitud coseno entre dos vectores; 0 si dimensiones no coinciden. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Ejecuta una promesa y se traga cualquier error (para caminos fire-and-forget). */
function safe<T>(p: Promise<T>): Promise<T | null> {
  return p.catch((err) => {
    console.error('[memory] operación de memoria falló (degradado)', err)
    return null
  })
}

// ---------- Embeddings ----------

type EmbedInputType = 'query' | 'passage'

/**
 * Embeds un lote de textos vía el proveedor OpenAI-compatible configurado.
 * Requiere Settings.llmEmbedModel (el modelo de chat NO sirve para embeddings).
 * Devuelve null si no hay configuración o el proveedor falla (degradación).
 */
export async function embedTexts(
  orgId: string,
  texts: string[],
  inputType: EmbedInputType = 'passage'
): Promise<number[][] | null> {
  if (texts.length === 0) return []
  try {
    const cfg = await getLLMConfig(orgId)
    const embedModel = (await db.settings.findUnique({
      where: { organizationId: orgId },
      select: { llmEmbedModel: true },
    }))?.llmEmbedModel
    if (!cfg.apiKey || !cfg.baseUrl || !embedModel) return null

    const body = {
      input: texts.map((t) => t.slice(0, MAX_MEMORY_TEXT)),
      model: embedModel,
      input_type: inputType,
      truncate: 'END',
    }
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      // Algunos proveedores OpenAI-compatibles no aceptan input_type: reintento sin él.
      const retry = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ ...body, input_type: undefined }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!retry.ok) {
        console.error('[memory] embeddings falló', res.status, await res.text().catch(() => ''))
        return null
      }
      return parseEmbedResponse(await retry.json())
    }
    return parseEmbedResponse(await res.json())
  } catch (err) {
    console.error('[memory] embedTexts degradado', err)
    return null
  }
}

/** Normaliza la respuesta del endpoint /embeddings (formato OpenAI). */
function parseEmbedResponse(data: unknown): number[][] | null {
  const rows = (data as { data?: Array<{ embedding?: unknown }> })?.data
  if (!Array.isArray(rows) || rows.length === 0) return null
  const vectors = rows.map((r) => (Array.isArray(r.embedding) ? r.embedding.map(Number) : null))
  if (vectors.some((v) => !v || !v.every((n) => Number.isFinite(n)))) return null
  return vectors as number[][]
}

// ---------- Escritura: recordar mensajes ----------

/** Guarda un fragmento de conversación con embedding best-effort. Nunca lanza. */
export async function rememberMessage(opts: {
  orgId: string
  clientId: string | null
  channel: string
  role: 'incoming' | 'outgoing'
  text: string
}): Promise<void> {
  const text = (opts.text || '').trim().slice(0, MAX_MEMORY_TEXT)
  if (!text) return
  await safe(
    (async () => {
      const vectors = await embedTexts(opts.orgId, [text], 'passage')
      await db.conversationEmbedding.create({
        data: {
          organizationId: opts.orgId,
          clientId: opts.clientId,
          channel: opts.channel,
          role: opts.role,
          text,
          embedding: vectors && vectors[0] ? JSON.stringify(vectors[0]) : null,
        },
      })
    })()
  )
}

/**
 * Si el cliente acumuló suficientes fragmentos sin consolidar, dispara la
 * consolidación en background (fire-and-forget; nunca lanza).
 */
export function maybeConsolidate(orgId: string, clientId: string | null): void {
  safe(
    (async () => {
      const pending = await db.conversationEmbedding.count({
        where: {
          organizationId: orgId,
          ...(clientId ? { clientId } : {}),
          consolidated: false,
        },
      })
      if (pending >= CONSOLIDATE_THRESHOLD) await consolidateMemory({ orgId, clientId })
    })()
  )
}

// ---------- Lectura: recall semántico ----------

interface RecallRow {
  text: string
  channel: string
  role: string
  embedding: string | null
  createdAt: Date
}

/**
 * Bloque de texto con los fragmentos más relevantes para el prompt.
 * Con embeddings → top-K por similitud coseno + ancla de recencia (últimos 2).
 * Sin embeddings → simplemente los últimos K (modo degradado).
 */
export function formatRecallBlock(rows: RecallRow[]): string {
  if (rows.length === 0) return ''
  const lines = rows.map((r) => {
    const fecha = r.createdAt.toISOString().slice(0, 10)
    const quien = r.role === 'outgoing' ? 'negocio' : 'cliente'
    return `- (${r.channel}, ${quien}, ${fecha}) ${r.text}`
  })
  return `\n\nMEMORIA DE CONVERSACIONES ANTERIORES (hechos recordados por similitud; úsalos si aportan, no los menciones textualmente):\n${lines.join('\n')}`
}

/**
 * Recupera el contexto de memoria del cliente más relevante para `query`.
 * Nunca lanza: ante cualquier problema devuelve '' (el agente responde sin memoria).
 */
export async function recallContext(opts: {
  orgId: string
  clientId: string | null
  query: string
  k?: number
}): Promise<string> {
  try {
    const { orgId, clientId, query } = opts
    const k = Math.min(Math.max(opts.k ?? 6, 1), 12)
    if (!clientId) return ''
    const rows = await db.conversationEmbedding.findMany({
      where: { organizationId: orgId, clientId },
      orderBy: { createdAt: 'desc' },
      take: RECALL_SCAN_LIMIT,
      select: { text: true, channel: true, role: true, embedding: true, createdAt: true },
    })
    if (rows.length === 0) return ''

    const qVec = (await embedTexts(orgId, [query], 'query'))?.[0] ?? null
    let chosen: RecallRow[] = []
    if (qVec) {
      const scored = rows
        .map((r) => ({ row: r, sim: qVec && r.embedding ? cosine(qVec, parseVector(r.embedding) ?? []) : -1 }))
        .filter((s) => s.sim >= 0)
        .sort((a, b) => b.sim - a.sim)
      chosen = scored.slice(0, k).map((s) => s.row)
      // Ancla de recencia: los 2 mensajes más nuevos siempre entran si no están.
      for (const recent of rows.slice(0, 2)) {
        if (!chosen.some((c) => c.createdAt === recent.createdAt && c.text === recent.text)) chosen.push(recent)
      }
    } else {
      chosen = rows.slice(0, k)
    }
    return formatRecallBlock(chosen)
  } catch (err) {
    console.error('[memory] recallContext degradado', err)
    return ''
  }
}

// ---------- Lecciones de estilo (self-improving) ----------

/** Bloque few-shot con correcciones del vendedor relevantes a la consulta. */
export function formatStyleLessons(rows: Array<{ original: string; final: string }>): string {
  if (rows.length === 0) return ''
  const lines = rows.map((r) => `- ANTES: ${r.original}\n  AHORA (estilo del vendedor): ${r.final}`)
  return `\n\nLECCIONES DE ESTILO DEL VENDEDOR (así corrigió mensajes sugeridos anteriormente; imita ese criterio):\n${lines.join('\n')}`
}

/** Recupera las lecciones de estilo más relevantes (semántico o recencia). */
export async function recallStyleLessons(opts: {
  orgId: string
  clientId: string | null
  query: string
  k?: number
}): Promise<string> {
  try {
    const k = Math.min(Math.max(opts.k ?? 3, 1), 6)
    const rows = await db.agentCorrection.findMany({
      where: {
        organizationId: opts.orgId,
        ...(opts.clientId ? { clientId: opts.clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: RECALL_SCAN_LIMIT,
      select: { original: true, final: true, embedding: true },
    })
    if (rows.length === 0) return ''
    const qVec = (await embedTexts(opts.orgId, [opts.query], 'query'))?.[0] ?? null
    if (qVec) {
      const scored = rows
        .map((r) => ({ row: r, sim: r.embedding ? cosine(qVec, parseVector(r.embedding) ?? []) : 0 }))
        .sort((a, b) => b.sim - a.sim)
      return formatStyleLessons(scored.slice(0, k).map((s) => s.row))
    }
    return formatStyleLessons(rows.slice(0, k))
  } catch (err) {
    console.error('[memory] recallStyleLessons degradado', err)
    return ''
  }
}

/** Registra una corrección del vendedor (original → final). Nunca lanza. */
export async function rememberCorrection(opts: {
  orgId: string
  clientId: string | null
  original: string
  final: string
  channel?: string | null
}): Promise<void> {
  const original = (opts.original || '').trim().slice(0, MAX_MEMORY_TEXT)
  const final = (opts.final || '').trim().slice(0, MAX_MEMORY_TEXT)
  if (!original || !final || original === final) return
  await safe(
    (async () => {
      const vectors = await embedTexts(opts.orgId, [original], 'passage')
      await db.agentCorrection.create({
        data: {
          organizationId: opts.orgId,
          clientId: opts.clientId,
          original,
          final,
          channel: opts.channel || null,
          embedding: vectors && vectors[0] ? JSON.stringify(vectors[0]) : null,
        },
      })
    })()
  )
}

// ---------- Consolidación: de fragmentos a hechos duraderos ----------

const CONSOLIDATE_SYSTEM_PROMPT = `Eres la memoria a largo plazo de un agente comercial. Recibes fragmentos de conversaciones con un cliente (canal WhatsApp/Telegram) y extraes SOLO los hechos duraderos que valen la pena recordar para futuras conversaciones (preferencias, compromisos, contexto familiar/laboral, objeciones recurrentes, datos de contacto nuevos, estado del negocio del cliente).

Responde SIEMPRE en español y SOLO con un objeto JSON válido:
{"facts": ["<hecho breve en tercera persona, máximo 25 palabras>", ...]}

Reglas: máximo 5 hechos; no inventes nada que no esté en los fragmentos; si no hay nada digno de recordar devuelve {"facts": []}; no repitas hechos que ya estén en la lista de hechos conocidos.`

/**
 * Resume los fragmentos no consolidados en hechos duraderos (AgentMemory) con
 * deduplicación semántica contra los hechos existentes. Devuelve el número de
 * hechos nuevos. Nunca lanza (devuelve 0 y loguea).
 */
export async function consolidateMemory(opts: {
  orgId: string
  clientId: string | null
}): Promise<number> {
  try {
    const pending = await db.conversationEmbedding.findMany({
      where: {
        organizationId: opts.orgId,
        ...(opts.clientId ? { clientId: opts.clientId } : {}),
        consolidated: false,
      },
      orderBy: { createdAt: 'asc' },
      take: 16,
      select: { id: true, text: true, role: true, channel: true, createdAt: true },
    })
    if (pending.length < 4) return 0

    const existing = await db.agentMemory.findMany({
      where: { organizationId: opts.orgId, source: 'agent' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, content: true, embedding: true },
    })

    const transcript = pending
      .map((p) => `- (${p.channel}, ${p.role === 'outgoing' ? 'negocio' : 'cliente'}) ${p.text}`)
      .join('\n')
    const knownFacts = existing.map((e) => `- ${e.content}`).join('\n')
    const raw = await llmChat(
      opts.orgId,
      [
        { role: 'system', content: CONSOLIDATE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `FRAGMENTOS RECIENTES:\n${transcript}\n\nHECHOS YA CONOCIDOS (no repitas):\n${knownFacts || '(ninguno)'}`,
        },
      ],
      { jsonMode: true, temperature: 0.2 }
    )
    const parsed = extractJson<{ facts?: unknown }>(raw)
    const facts = Array.isArray(parsed?.facts)
      ? (parsed as { facts: unknown[] }).facts.filter((f): f is string => typeof f === 'string' && f.trim() !== '').slice(0, 5)
      : []
    if (facts.length === 0) {
      await db.conversationEmbedding.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { consolidated: true },
      })
      return 0
    }

    const vectors = await embedTexts(opts.orgId, facts, 'passage')
    const kept: Array<{ content: string; vec: number[] | null }> = []
    let created = 0
    for (let i = 0; i < facts.length; i++) {
      const content = facts[i].trim().slice(0, 500)
      const vec = vectors && vectors[i] ? vectors[i] : null
      // Deduplicación semántica contra hechos existentes y contra los nuevos.
      const dupAgainst = [...existing.map((e) => ({ vec: parseVector(e.embedding) })), ...kept.map((k) => ({ vec: k.vec }))]
      const isDup =
        vec !== null &&
        dupAgainst.some(({ vec: other }) => other && other.length === vec.length && cosine(vec, other) >= DEDUP_SIMILARITY)
      if (isDup) continue
      await db.agentMemory.create({
        data: {
          organizationId: opts.orgId,
          clientId: opts.clientId,
          key: 'fact',
          content,
          source: 'agent',
          importance: 2,
          embedding: vec ? JSON.stringify(vec) : null,
        },
      })
      kept.push({ content, vec })
      created++
    }
    await db.conversationEmbedding.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { consolidated: true },
    })
    return created
  } catch (err) {
    console.error('[memory] consolidateMemory degradado', err)
    return 0
  }
}
