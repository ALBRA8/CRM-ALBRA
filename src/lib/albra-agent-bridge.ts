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

import { createHmac } from 'crypto'
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

// Configuración desde variables de entorno.
// P-01 (plan v1.0): NINGUNA credencial por defecto. El viejo fallback
// 'albra-dev-token' fue eliminado — una credencial de desarrollo jamás debe
// colarse en producción. Sin ALBRA_AGENT_API_KEY la EJECUCIÓN es fail-closed
// (el health probe sigue permitido: endpoint no autenticado, solo estado).
const AGENT_URL = (process.env.ALBRA_AGENT_URL || 'http://localhost:9000').replace(/\/+$/, '')
const AGENT_API_KEY = (process.env.ALBRA_AGENT_API_KEY || process.env.ALBRA_API_KEY || '').trim()
const AGENT_SIGNING_KEY = (process.env.ALBRA_AGENT_SIGNING_KEY || '').trim()
const AGENT_ENABLED = process.env.ALBRA_AGENT_ENABLED !== 'false'
const TIMEOUT_MS = Number(process.env.ALBRA_AGENT_TIMEOUT_MS || 25000)

/** Indica si hay credencial de servicio configurada (contrato P-01). */
export function agentCredentialConfigured(): boolean {
  return AGENT_API_KEY.length > 0
}

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
 *
 * Contrato P-01/P-02 (plan v1.0):
 *  - Fail-closed sin credencial de servicio (nunca credenciales dev en prod).
 *  - Propagación de tenant OBLIGATORIA: organization_id en el body y cabecera
 *    X-Albra-Org; el Agente debe aislar memoria/sesiones por org (P-02).
 *  - La sesión se NOMBREA con namespace de org (`<orgId>:<sessionId>`) como
 *    defensa en profundidad aunque el Agente aún no filtre por organization_id.
 *  - Si ALBRA_AGENT_SIGNING_KEY está definida, cada request se firma
 *    (X-Albra-Timestamp + X-Albra-Signature = HMAC-SHA256("<ts>.<body>")):
 *    el Agente verifica timing-safe y rechaza timestamps con más de 5 min.
 */
export async function executeAgentQuery(params: {
  input: string
  sessionId?: string
  orgId?: string
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

  // P-01: sin credencial de servicio no hay ejecución (fail-closed, sin fetch).
  if (!agentCredentialConfigured()) {
    return {
      ok: false,
      content: '',
      source: 'local-fallback',
      error: 'Credencial de servicio no configurada (ALBRA_AGENT_API_KEY) — contrato P-01',
    }
  }

  // Comprobar salud previa para evitar timeout innecesario si está caído.
  // force=true: una ejecución real nunca debe basarse en una caché de salud
  // envenenada por un fallo transitorio previo (contrato del test del bridge).
  const health = await checkAgentHealth(true)
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

  // P-02: propagación de tenant en body + cabecera + namespace de sesión.
  const orgId = (params.orgId || '').trim()
  const sessionId = params.sessionId
    ? orgId
      ? `${orgId}:${params.sessionId}`
      : params.sessionId
    : undefined

  try {
    const body = JSON.stringify({
      input: params.input,
      session_id: sessionId || undefined,
      organization_id: orgId || undefined,
      timeout_seconds: Math.round(timeoutMs / 1000),
    })
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AGENT_API_KEY}`,
    }
    if (orgId) headers['X-Albra-Org'] = orgId
    if (AGENT_SIGNING_KEY) {
      const ts = Date.now().toString()
      headers['X-Albra-Timestamp'] = ts
      headers['X-Albra-Signature'] = createHmac('sha256', AGENT_SIGNING_KEY).update(`${ts}.${body}`).digest('hex')
    }

    const res = await fetch(`${AGENT_URL}/api/v1/execution`, {
      method: 'POST',
      headers,
      body,
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
