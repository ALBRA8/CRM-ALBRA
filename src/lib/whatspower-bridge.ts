import { createHmac, randomUUID } from 'crypto'

/**
 * Bridge CRM-ALBRA → WHATSPOWER (Nivel 2).
 *
 * Contrato REAL declarado por WHATSPOWER (README + src/server.ts):
 *
 * 1. Inbound Bridge — CRM reenvía mensajes entrantes de WhatsApp a
 *    `POST {WHATSPOWER}/api/inbound` con firma HMAC-SHA256:
 *      header X-Signature-SHA256: <hex hmac-sha256(rawBody, secret)>
 *      header X-Timestamp: <epoch ms> — LIGADO a la firma (canonical `${ts}.${body}`, v2)
 *      body: { eventId, orgId, contact: { phone, name? }, message: { text } }
 *    WHATSPOWER valida la firma con su AGENTIC_2A_WEBHOOK_SECRET/WEBHOOK_SECRET.
 *
 * 2. CRM Stage Triggers — cuando una Opportunity cambia de etapa, el CRM
 *    notifica `POST {WHATSPOWER}/api/crm/stage-change` con:
 *      body: { clientId, clientPhone, clientName?, opportunityId,
 *              fromStage, toStage, dealValue? }
 *    (endpoint interno de red local; sin auth por diseño del receptor).
 *
 * SEGURIDAD Y ROBUSTEZ:
 * - Fire-and-forget: un fallo de WHATSPOWER NUNCA rompe el flujo del CRM
 *   (el webhook de WhatsApp sigue procesando y la IA sigue respondiendo).
 * - Sin config (WHATSPOWER_ENABLED != 'true') es un no-op puro.
 * - El secret nunca se loguea; los errores se registran truncados.
 * - Multi-tenancy: el orgId del CRM viaja en el evento inbound para que
 *   WHATSPOWER lo use solo como metadato de trazabilidad.
 *
 * Env:
 *   WHATSPOWER_ENABLED=true                  → activa el bridge (default: off)
 *   WHATSPOWER_INBOUND_URL                   → default http://localhost:3003/api/inbound
 *   WHATSPOWER_STAGE_URL                     → default http://localhost:3003/api/crm/stage-change
 *   WHATSPOWER_WEBHOOK_SECRET                → secret HMAC compartido con WhatsPower
 */

const INBOUND_TIMEOUT_MS = 3_000
const STAGE_TIMEOUT_MS = 3_000

export function isWhatspowerEnabled(): boolean {
  return process.env.WHATSPOWER_ENABLED === 'true'
}

function inboundUrl(): string {
  return process.env.WHATSPOWER_INBOUND_URL || 'http://localhost:3003/api/inbound'
}

function stageUrl(): string {
  return process.env.WHATSPOWER_STAGE_URL || 'http://localhost:3003/api/crm/stage-change'
}

function sharedSecret(): string | null {
  const s = process.env.WHATSPOWER_WEBHOOK_SECRET
  return s && s.trim() ? s.trim() : null
}

/**
 * Firma v2 (reparación integral 2026-11-06): el timestamp queda LIGADO a la
 * firma. Canonical: `${timestamp}.${rawBody}` — igual formato que WHATSPOWER
 * verifica en /api/inbound con checkWebhookSecurity v2 (hex puro, sin prefijo).
 */
export function signWhatspowerPayload(timestamp: string | number, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${String(timestamp)}.${rawBody}`, 'utf8').digest('hex')
}

export interface WhatspowerInboundInput {
  orgId: string
  phone: string
  name?: string | null
  text: string
  /** id del mensaje de canal para trazabilidad; si falta se genera uno estable */
  messageId?: string | null
}

export interface WhatspowerStageChangeInput {
  orgId: string
  clientId?: string | null
  clientPhone?: string | null
  clientName?: string | null
  opportunityId: string
  fromStage: string
  toStage: string
  dealValue?: number | null
}

interface WhatspowerBridgeResult {
  sent: boolean
  skipped: 'disabled' | 'no_secret' | 'no_config' | 'inbound_error'
  status?: number
  error?: string
}

/**
 * Reenvía un mensaje entrante de WhatsApp al motor conversacional de
 * WHATSPOWER. Nunca lanza: devuelve el resultado para trazabilidad y deja
 * log de servidor si algo falla.
 */
export async function forwardInboundToWhatspower(input: WhatspowerInboundInput): Promise<WhatspowerBridgeResult> {
  if (!isWhatspowerEnabled()) return { sent: false, skipped: 'disabled' }
  const secret = sharedSecret()
  if (!secret) {
    console.error('[whatspower-bridge] WHATSPOWER_ENABLED=true pero WHATSPOWER_WEBHOOK_SECRET no está definido; evento inbound no enviado')
    return { sent: false, skipped: 'no_secret' }
  }

  const payload = {
    eventId: input.messageId || `crm_${randomUUID()}`,
    orgId: input.orgId,
    contact: { phone: input.phone, ...(input.name ? { name: input.name } : {}) },
    message: { text: input.text },
  }
  const rawBody = JSON.stringify(payload)
  const ts = String(Date.now())
  const signature = signWhatspowerPayload(ts, rawBody, secret)

  try {
    const res = await fetch(inboundUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-SHA256': signature,
        'X-Timestamp': ts,
      },
      body: rawBody,
      signal: AbortSignal.timeout(INBOUND_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      console.error(`[whatspower-bridge] inbound ${res.status}: ${detail}`)
      return { sent: false, skipped: 'inbound_error', status: res.status, error: detail }
    }
    console.log(`[whatspower-bridge] inbound entregado a WHATSPOWER (eventId=${payload.eventId})`)
    return { sent: true, skipped: 'inbound_error' }
  } catch (err) {
    console.error('[whatspower-bridge] inbound no entregado:', err instanceof Error ? err.message : err)
    return { sent: false, skipped: 'inbound_error', error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Notifica a WHATSPOWER un cambio de etapa de oportunidad para que sus
 * CRM Stage Triggers disparen mensajes/flujos/secuencias. Fire-and-forget.
 */
export async function notifyWhatspowerStageChange(input: WhatspowerStageChangeInput): Promise<WhatspowerBridgeResult> {
  if (!isWhatspowerEnabled()) return { sent: false, skipped: 'disabled' }

  const payload = {
    clientId: input.clientId || undefined,
    clientPhone: input.clientPhone || undefined,
    clientName: input.clientName || undefined,
    opportunityId: input.opportunityId,
    fromStage: input.fromStage,
    toStage: input.toStage,
    ...(typeof input.dealValue === 'number' && Number.isFinite(input.dealValue) ? { dealValue: input.dealValue } : {}),
  }
  const rawBody = JSON.stringify(payload)

  // (reparación integral) /api/crm/stage-change es administrativa en WHATSPOWER:
  // exige Bearer INTERNAL_API_SECRET. Sin el header la llamada moría en 401 y los
  // CRM Stage Triggers nunca disparaban (fallo silencioso fire-and-forget).
  const internalSecret = process.env.WHATSPOWER_INTERNAL_API_SECRET || process.env.WHATSPOWER_WEBHOOK_SECRET || ''
  if (!internalSecret) {
    console.warn('[whatspower-bridge] stage-change omitido: falta WHATSPOWER_INTERNAL_API_SECRET')
    return { sent: false, skipped: 'no_config', status: 0 }
  }

  try {
    const res = await fetch(stageUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${internalSecret}` },
      body: rawBody,
      signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      console.error(`[whatspower-bridge] stage-change ${res.status}: ${detail}`)
      return { sent: false, skipped: 'inbound_error', status: res.status, error: detail }
    }
    console.log(`[whatspower-bridge] stage-change entregado a WHATSPOWER (opportunityId=${input.opportunityId}, ${input.fromStage} → ${input.toStage})`)
    return { sent: true, skipped: 'inbound_error' }
  } catch (err) {
    console.error('[whatspower-bridge] stage-change no entregado:', err instanceof Error ? err.message : err)
    return { sent: false, skipped: 'inbound_error', error: err instanceof Error ? err.message : String(err) }
  }
}
