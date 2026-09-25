import { db } from './db'
import { decryptSecret } from './crypto'

/**
 * Capa de IA del agente comercial 24/7.
 * Prioridad: 1) LLM configurado por la organización (OpenAI/Groq/compatible),
 * 2) fallback al SDK nativo del entorno (z-ai-web-dev-sdk) para que el
 * preview funcione sin configurar llaves.
 * Solo para uso en servidor (route handlers).
 */

export interface LLMConfig {
  provider: string | null
  baseUrl: string | null
  model: string | null
  apiKey: string | null
}

export async function getLLMConfig(orgId: string): Promise<LLMConfig> {
  const settings = await db.settings.findUnique({ where: { organizationId: orgId } })
  const apiKey = decryptSecret(settings?.llmApiKeyEnc)
  return {
    provider: settings?.llmProvider || (apiKey ? 'custom' : 'zai'),
    baseUrl: settings?.llmBaseUrl || null,
    model: settings?.llmModel || null,
    apiKey,
  }
}

export async function llmChat(
  orgId: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: { jsonMode?: boolean; temperature?: number } = {}
): Promise<string> {
  const cfg = await getLLMConfig(orgId)

  if (cfg.apiKey && cfg.baseUrl) {
    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model || 'gpt-4o-mini',
          messages,
          temperature: opts.temperature ?? 0.4,
          ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const data = await res.json()
        const content = data?.choices?.[0]?.message?.content
        if (content) return content as string
      } else {
        console.error('[ai] LLM externo respondió', res.status, await res.text().catch(() => ''))
      }
    } catch (err) {
      console.error('[ai] error llamando LLM externo, uso fallback z-ai', err)
    }
  }

  // Fallback: SDK nativo del entorno (sin llave configurada). Envuelto en try/catch:
  // fuera del sandbox (VPS/Docker/Vercel) el SDK no existe y NO debe tumbar la app
  // con 500 críptico (auditoría Antigravity, crítico #6) — se informa con claridad.
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk')
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    })
    return completion.choices[0]?.message?.content ?? ''
  } catch (err) {
    console.error('[ai] sin proveedor LLM disponible', err)
    throw new Error(
      'No hay proveedor de IA disponible. Configura tu LLM (OpenAI/Groq/compatible) en Configuración → Agente IA con llmBaseUrl + llmApiKey, o define las credenciales del entorno.'
    )
  }
}

/** Extrae el primer objeto JSON de un texto (tolerante a markdown fences) */
export function extractJson<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim()
    const start = cleaned.indexOf('{')
    const arrStart = cleaned.indexOf('[')
    const from = start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart)
    if (from === -1) return null
    const candidate = cleaned.slice(from)
    // buscar el cierre balanceado
    let depth = 0
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i]
      if (ch === '{' || ch === '[') depth++
      if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) {
          return JSON.parse(candidate.slice(0, i + 1)) as T
        }
      }
    }
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}
