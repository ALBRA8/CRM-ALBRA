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
 *      body: { eventId, orgId, clientId, clientPhone, clientName?,
 *              opportunityId, fromStage, toStage, dealValue? }
 *      header X-Org-Id + Authorization: Bearer <credencial de servicio de la org>
 *    (contrato §5: la organización viaja en la identidad; el receptor valida
 *    credencial↔org con fail-closed — auditoría A1-06 2026-11-11: NUNCA se
 *    usa el secreto HMAC del webhook inbound como Bearer admin).
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
  /**
   * (OLEADA 2, contrato v2) Identidad ÚNICA de esta ocurrencia del evento:
   * WHATSPOWER la usa como clave de idempotencia — un replay del mismo
   * evento NO vuelve a disparar la automatización ni reenvía el mensaje.
   * Si se omite, el receptor deriva una clave determinista.
   */
  eventId?: string
}

interface WhatspowerBridgeResult {
  sent: boolean
  /** Solo se define cuando sent=false (por qué no se envió). */
  skipped?: 'disabled' | 'no_secret' | 'no_config' | 'inbound_error'
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
    return { sent: true }
  } catch (err) {
    console.error('[whatspower-bridge] inbound no entregado:', err instanceof Error ? err.message : err)
    return { sent: false, skipped: 'inbound_error', error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * (Auditoría A4-01, 2026-11-11) Deriva el eventId DETERMINISTA de una
 * transición de etapa: sha256(org|opportunity|from|to|ventanaTemporal).
 *
 * ¿Por qué con ventana y no aleatorio ni eterno?
 *  - ALEATORIO (comportamiento anterior): un reintento del PUT generaba un
 *    eventId NUEVO → WHATSPOWER lo trataba como evento nuevo → MENSAJE
 *    DUPLICADO al cliente vía Meta Cloud (el peor fallo posible).
 *  - ETERNO (mismo eventId para siempre): una transición legítima repetida
 *    meses después (A→B de nuevo) sería tragada por stage_change_dedup.
 *  - VENTANA (5 min): un reintento dentro de la ventana reutiliza el MISMO
 *    eventId (dedup extremo a extremo); una nueva transición posterior cae
 *    en otra ventana y se procesa. WHATSPOWER purga dedups > 24 h (A4-06).
 */
export const STAGE_EVENT_WINDOW_MS = 5 * 60 * 1000

export function deriveStageEventId(
  orgId: string,
  opportunityId: string,
  fromStage: string,
  toStage: string,
  now: number = Date.now(),
): string {
  const windowBucket = Math.floor(now / STAGE_EVENT_WINDOW_MS)
  return createHmac('sha256', 'albra-stage-event-v1')
    .update(`${orgId}|${opportunityId}|${fromStage}|${toStage}|${windowBucket}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
}

/**
 * Notifica a WHATSPOWER un cambio de etapa de oportunidad para que sus
 * CRM Stage Triggers disparen mensajes/flujos/secuencias. Fire-and-forget.
 */
export async function notifyWhatspowerStageChange(input: WhatspowerStageChangeInput): Promise<WhatspowerBridgeResult> {
  if (!isWhatspowerEnabled()) return { sent: false, skipped: 'disabled' }

  // ================================================================
  // CONTRATO CRM→WHATSPOWER §5 (reparación integral 2026-11-06):
  // La organización viaja en la IDENTIDAD, no solo en el body:
  //  - header X-Org-Id: la org del evento (auditable en el receptor);
  //  - Bearer: credencial de servicio DE ESA ORGANIZACIÓN
  //    (WHATSPOWER_ORG_SERVICE_CREDENTIALS='{"orgId":"cred",...}') si está
  //    configurada; si no, el secreto central (WHATSPOWER_INTERNAL_API_SECRET)
  //    — el receptor valida en ambos casos que body.orgId === X-Org-Id y que
  //    la credencial corresponde a ESA organización (fail-closed en el receptor).
  // ================================================================
  const orgId = String(input.orgId || '').trim()
  if (!orgId) {
    console.warn('[whatspower-bridge] stage-change omitido: evento sin orgId (contrato §5)')
    return { sent: false, skipped: 'no_config', status: 0 }
  }
  const payload = {
    // (OLEADA 2 + auditoría A4-01) eventId DETERMINISTA por transición dentro
    // de una ventana temporal: el reintento del PUT reutiliza el MISMO eventId
    // y WHATSPOWER lo deduplica en stage_change_dedup — sin duplicar mensaje.
    eventId: input.eventId || `sevt_${deriveStageEventId(orgId, input.opportunityId, input.fromStage, input.toStage)}`,
    orgId,
    clientId: input.clientId || undefined,
    clientPhone: input.clientPhone || undefined,
    clientName: input.clientName || undefined,
    opportunityId: input.opportunityId,
    fromStage: input.fromStage,
    toStage: input.toStage,
    ...(typeof input.dealValue === 'number' && Number.isFinite(input.dealValue) ? { dealValue: input.dealValue } : {}),
  }
  const rawBody = JSON.stringify(payload)

  let orgCredential = ''
  const rawMap = process.env.WHATSPOWER_ORG_SERVICE_CREDENTIALS
  if (rawMap) {
    try {
      const map = JSON.parse(rawMap) as Record<string, string>
      orgCredential = typeof map[orgId] === 'string' ? map[orgId] : ''
    } catch { /* mapa inválido: se usa el secreto central */ }
  }
  // (A1-06) El secreto HMAC del webhook inbound (WHATSPOWER_WEBHOOK_SECRET)
  // JAMÁS se usa como Bearer de stage-change: el receptor lo rechazaría
  // (no es una credencial de servicio registrada) y el evento se perdería
  // en un 401 silencioso. Solo credencial por-org o secreto interno admin.
  const internalSecret = orgCredential || process.env.WHATSPOWER_INTERNAL_API_SECRET || ''
  if (!internalSecret) {
    console.warn('[whatspower-bridge] stage-change omitido: falta credencial de la organización o WHATSPOWER_INTERNAL_API_SECRET')
    return { sent: false, skipped: 'no_config', status: 0 }
  }

  try {
    const res = await fetch(stageUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${internalSecret}`,
        'X-Org-Id': orgId,
      },
      body: rawBody,
      signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      console.error(`[whatspower-bridge] stage-change ${res.status}: ${detail}`)
      return { sent: false, skipped: 'inbound_error', status: res.status, error: detail }
    }
    console.log(`[whatspower-bridge] stage-change entregado a WHATSPOWER (opportunityId=${input.opportunityId}, ${input.fromStage} → ${input.toStage})`)
    return { sent: true }
  } catch (err) {
    console.error('[whatspower-bridge] stage-change no entregado:', err instanceof Error ? err.message : err)
    return { sent: false, skipped: 'inbound_error', error: err instanceof Error ? err.message : String(err) }
  }
}
