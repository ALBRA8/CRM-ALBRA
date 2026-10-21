/**
 * CRM ALBRA - AGENTE GENERAL Bridge (ALBRA AGENT SEED V1.0 Integration)
 *
 * Conecta el "chaleco" (CRM ALBRA en Next.js) con el "cerebro" (AGENTE GENERAL en Python / FastAPI).
 * Provee:
 *  1. Ejecución cognitiva vía POST /api/v1/execution.
 *  2. Health check con caché para no penalizar latencia si el agente está offline.
 *  3. Fallback transparente al LLM local (llmChat) si el Agente General no responde.
 *  4. Detección y normalización de acciones / tool-calling para la BD de Prisma.
 */

import { extractJson } from './ai'

export interface AgentExecutionResult {
  ok: boolean
  content: string
  action?: string
  params?: Record<string, unknown>
  executionId?: string
  source: 'albra-agent' | 'local-fallback'
  error?: string
}

export interface AgentHealthStatus {
  online: boolean
  url: string
  status?: string
  version?: string
  lastChecked: string
  latencyMs?: number
  error?: string
}

// Configuración desde variables de entorno
const AGENT_URL = (process.env.ALBRA_AGENT_URL || 'http://localhost:9000').replace(/\/+$/, '')
const AGENT_API_KEY = (process.env.ALBRA_AGENT_API_KEY || process.env.ALBRA_API_KEY || 'albra-dev-token').trim()
const AGENT_ENABLED = process.env.ALBRA_AGENT_ENABLED !== 'false'
const TIMEOUT_MS = Number(process.env.ALBRA_AGENT_TIMEOUT_MS || 25000)

// Caché de salud (30 segundos)
let cachedHealth: { online: boolean; checkedAt: number; error?: string } | null = null
const HEALTH_CACHE_TTL_MS = 30_000

/**
 * Verifica si el Agente General está accesible y responde.
 */
export async function checkAgentHealth(force = false): Promise<AgentHealthStatus> {
  const now = Date.now()
  if (!force && cachedHealth && now - cachedHealth.checkedAt < HEALTH_CACHE_TTL_MS) {
    return {
      online: cachedHealth.online,
      url: AGENT_URL,
      lastChecked: new Date(cachedHealth.checkedAt).toISOString(),
      error: cachedHealth.error,
    }
  }

  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3500)

    const res = await fetch(`${AGENT_URL}/api/v1/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    const latencyMs = Date.now() - start

    if (!res.ok) {
      cachedHealth = { online: false, checkedAt: now, error: `HTTP ${res.status}` }
      return { online: false, url: AGENT_URL, lastChecked: new Date().toISOString(), latencyMs, error: `HTTP ${res.status}` }
    }

    const data = (await res.json().catch(() => ({}))) as { status?: string; version?: string }
    cachedHealth = { online: true, checkedAt: now }

    return {
      online: true,
      url: AGENT_URL,
      status: data.status || 'healthy',
      version: data.version,
      lastChecked: new Date().toISOString(),
      latencyMs,
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    cachedHealth = { online: false, checkedAt: now, error: errorMsg }
    return {
      online: false,
      url: AGENT_URL,
      lastChecked: new Date().toISOString(),
      latencyMs: Date.now() - start,
      error: errorMsg,
    }
  }
}

/**
 * Indica si el Agente General está habilitado en configuración.
 */
export function isAgentBridgeEnabled(): boolean {
  return AGENT_ENABLED && !!AGENT_URL
}

/**
 * Ejecuta una consulta cognitiva en el Agente General (POST /api/v1/execution).
 */
export async function executeAgentQuery(params: {
  input: string
  sessionId?: string
  timeoutSeconds?: number
}): Promise<AgentExecutionResult> {
  if (!isAgentBridgeEnabled()) {
    return {
      ok: false,
      content: '',
      source: 'local-fallback',
      error: 'Agente General deshabilitado por configuración',
    }
  }

  // Comprobar salud previa para evitar timeout innecesario si está caído
  const health = await checkAgentHealth()
  if (!health.online) {
    return {
      ok: false,
      content: '',
      source: 'local-fallback',
      error: `Agente General offline (${health.error || 'sin respuesta'})`,
    }
  }

  const timeoutMs = (params.timeoutSeconds ? params.timeoutSeconds * 1000 : TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${AGENT_URL}/api/v1/execution`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AGENT_API_KEY}`,
      },
      body: JSON.stringify({
        input: params.input,
        session_id: params.sessionId || undefined,
        timeout_seconds: Math.round(timeoutMs / 1000),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      return {
        ok: false,
        content: '',
        source: 'local-fallback',
        error: `Agente General respondió HTTP ${res.status}: ${errBody.slice(0, 200)}`,
      }
    }

    const data = (await res.json()) as {
      content?: string
      execution_id?: string
      tool_calls?: Array<{ name?: string; parameters?: Record<string, unknown> }>
    }

    const rawContent = data.content || ''

    // Detectar si el contenido es una decisión JSON (formato estándar de CRM ALBRA)
    let action: string | undefined
    let actionParams: Record<string, unknown> | undefined

    // 1. Revisar tool_calls nativos del Agente General
    if (Array.isArray(data.tool_calls) && data.tool_calls.length > 0) {
      const first = data.tool_calls[0]
      if (first.name) {
        action = first.name
        actionParams = first.parameters || {}
      }
    }

    // 2. Si no viene en tool_calls, intentar parsear JSON en content
    if (!action && rawContent) {
      const jsonDecision = extractJson<{ action?: string; params?: Record<string, unknown>; reply?: string }>(rawContent)
      if (jsonDecision?.action) {
        action = jsonDecision.action
        actionParams = jsonDecision.params || {}
      }
    }

    return {
      ok: true,
      content: rawContent,
      action,
      params: actionParams,
      executionId: data.execution_id,
      source: 'albra-agent',
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      content: '',
      source: 'local-fallback',
      error: `Error de conexión con Agente General: ${errorMsg}`,
    }
  }
}
