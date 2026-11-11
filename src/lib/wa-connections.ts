/**
 * wa-connections.ts — Servicio de conexiones WhatsApp por organización (OLEADA 2).
 *
 * Núcleo de la decisión de negocio 2026-11-11:
 *  - cada org conecta SUS números con SUS credenciales Meta (Embedded Signup);
 *  - credenciales cifradas y asociadas EXCLUSIVAMENTE a su organization_id;
 *  - atribución automática número→organización (phoneNumberId UNIQUE global);
 *  - límites por plan (según su plan);
 *  - desconexión/revocación aislada (una conexión no afecta a otras).
 *
 * Toda la lógica vive aquí para que las rutas API y el webhook la compartan y
 * las pruebas la ejerciten como unidad pura + integración (regla 9).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { encryptSecret, decryptSecret } from '@/lib/crypto'
import { canAddConnection } from '@/lib/whatsapp-plans'
import {
  exchangeCodeForToken,
  fetchPhoneNumberInfo,
  inspectTokenIdentity,
  generateWebhookVerifyToken,
  metaAppConfig,
} from '@/lib/meta-oauth'

export const ACTIVE_STATUSES = ['connected', 'pending'] as const

export interface CreateConnectionInput {
  orgId: string
  phoneNumberId: string
  accessToken: string
  wabaId?: string | null
  phoneNumber?: string | null
  displayName?: string | null
  source?: 'embedded_signup' | 'manual'
  metaAppSecret?: string | null
  tokenExpiresAt?: Date | null
  /** Inyectable para pruebas (no toca Graph API real). */
  verifyAgainstGraph?: boolean
  fetchImpl?: typeof fetch
}

export type CreateConnectionResult =
  | { ok: true; connectionId: string; status: string }
  | { ok: false; code: 'plan_limit' | 'duplicate' | 'invalid_token' | 'error'; message: string; limit?: number; planLabel?: string }

/** Conteo de conexiones activas (ocupan cupo del plan). */
export async function activeConnectionCount(orgId: string): Promise<number> {
  return db.whatsAppConnection.count({ where: { organizationId: orgId, status: { in: [...ACTIVE_STATUSES] } } })
}

/**
 * Registra una conexión WhatsApp para la organización.
 *  - Verifica límite de plan ANTES de crear (fail-closed).
 *  - phoneNumberId UNIQUE global: un número pertenece a UNA org (409 si duplicado).
 *  - Valida el token contra Graph (/me + /{phoneNumberId}) salvo skip en pruebas.
 *  - Token y app secret se guardan SIEMPRE cifrados (encryptSecret).
 *  - Audita el evento (connected | plan_limit_blocked | error).
 */
export async function createConnection(input: CreateConnectionInput): Promise<CreateConnectionResult> {
  const {
    orgId, phoneNumberId, accessToken, wabaId, phoneNumber, displayName,
    source = 'embedded_signup', metaAppSecret, tokenExpiresAt,
    verifyAgainstGraph = true, fetchImpl = fetch,
  } = input

  if (!phoneNumberId || !/^\d{6,20}$/.test(phoneNumberId)) {
    return { ok: false, code: 'error', message: 'phoneNumberId inválido' }
  }
  if (!accessToken || accessToken.length < 16) {
    return { ok: false, code: 'error', message: 'Token de acceso ausente o demasiado corto' }
  }

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true } })
  if (!org) return { ok: false, code: 'error', message: 'Organización no encontrada' }

  const activeCount = await activeConnectionCount(orgId)
  const gate = canAddConnection(org.plan, activeCount)
  if (!gate.allowed) {
    await auditEvent(null, orgId, 'plan_limit_blocked', `Plan ${org.plan}: límite ${gate.limit} conexiones activas`)
    return {
      ok: false, code: 'plan_limit',
      message: `Tu plan (${gate.planLabel}) permite ${gate.limit} número(s) conectado(s). Libera un número o mejora de plan.`,
      limit: gate.limit, planLabel: gate.planLabel,
    }
  }

  const duplicate = await db.whatsAppConnection.findUnique({ where: { phoneNumberId } })
  if (duplicate) {
    // No se revela a qué org pertenece (aislamiento: el llamador no aprende
    // datos de otras organizaciones).
    return { ok: false, code: 'duplicate', message: 'Este número de WhatsApp ya está conectado a otra cuenta' }
  }

  // Validación real del token contra Graph (el token debe representar algo operable).
  let resolvedPhone = phoneNumber ?? null
  let resolvedName = displayName ?? null
  let tokenOk = true
  let tokenError: string | null = null
  if (verifyAgainstGraph) {
    const identity = await inspectTokenIdentity(accessToken, fetchImpl)
    if (!identity.ok) {
      tokenOk = false
      tokenError = `Token rechazado por Meta: ${identity.error}`
    } else {
      const info = await fetchPhoneNumberInfo(phoneNumberId, accessToken, fetchImpl)
      if (!info.ok) {
        tokenOk = false
        tokenError = `El número ${phoneNumberId} no es operable con este token: ${info.error}`
      } else {
        resolvedPhone = info.displayPhoneNumber ?? info.phoneNumber ?? resolvedPhone
        resolvedName = info.verifiedName ?? resolvedName
      }
    }
  }
  if (!tokenOk) {
    await auditEvent(null, orgId, 'error', tokenError ?? undefined)
    return { ok: false, code: 'invalid_token', message: tokenError ?? 'Token inválido' }
  }

  const connection = await db.whatsAppConnection.create({
    data: {
      organizationId: orgId,
      wabaId: wabaId ?? null,
      phoneNumberId,
      phoneNumber: resolvedPhone ?? 'desconocido',
      displayName: resolvedName,
      accessTokenEnc: encryptSecret(accessToken) ?? '',
      metaAppSecretEnc: metaAppSecret ? encryptSecret(metaAppSecret) : null,
      webhookVerifyToken: generateWebhookVerifyToken(),
      status: 'connected',
      statusDetail: source === 'embedded_signup' ? 'Conectada vía Embedded Signup (flujo oficial Meta)' : 'Conectada manualmente por el administrador',
      source,
      tokenExpiresAt: tokenExpiresAt ?? null,
      lastVerifiedAt: new Date(),
    },
  })
  await auditEvent(connection.id, orgId, 'connected', `Número ${connection.phoneNumber} conectado (${source})`)
  return { ok: true, connectionId: connection.id, status: connection.status }
}

export type DisconnectResult =
  | { ok: true; status: string }
  | { ok: false; code: 'not_found'; message: string }

/**
 * Desconecta (o revoca) una conexión. AISLAMIENTO GARANTIZADO: la conexión se
 * busca SIEMPRE por (id, organizationId) — una org jamás toca conexiones de
 * otra (404 sin filtrar detalles). El token cifrado se DESTRUYE: la conexión
 * queda como histórico auditable sin material sensible.
 */
export async function disconnectConnection(
  orgId: string,
  connectionId: string,
  opts: { revoked?: boolean; detail?: string } = {},
): Promise<DisconnectResult> {
  const connection = await db.whatsAppConnection.findFirst({
    where: { id: connectionId, organizationId: orgId },
  })
  if (!connection) return { ok: false, code: 'not_found', message: 'Conexión no encontrada' }
  if (connection.status === 'disconnected' || connection.status === 'revoked') {
    return { ok: true, status: connection.status }
  }
  const status = opts.revoked ? 'revoked' : 'disconnected'
  await db.whatsAppConnection.update({
    where: { id: connection.id },
    data: {
      status,
      statusDetail: opts.detail ?? (opts.revoked
        ? 'Autorización revocada desde Meta o por la organización'
        : 'Desconectada por la organización'),
      accessTokenEnc: '', // destrucción del material sensible
      metaAppSecretEnc: null,
      lastVerifiedAt: null,
    },
  })
  await auditEvent(connection.id, orgId, status, `Número ${connection.phoneNumber}: ${status}`)
  return { ok: true, status }
}

/**
 * Resuelve a qué organización pertenece un phoneNumberId (decisión #4:
 * "WHATSPOWER deberá identificar automáticamente a qué organización pertenece
 * cada número, mensaje, conversación y evento"). NULL si el número no está
 * conectado — NUNCA se infiere la org desde el body de un webhook.
 */
export async function resolveOrgByPhoneNumberId(phoneNumberId: string) {
  if (!phoneNumberId) return null
  return db.whatsAppConnection.findUnique({
    where: { phoneNumberId },
    select: { id: true, organizationId: true, status: true, metaAppSecretEnc: true, webhookVerifyToken: true },
  })
}

/** Token en claro de una conexión (solo en memoria; NUNCA logueado). */
export async function resolveConnectionCredentials(orgId: string, connectionId: string): Promise<string | null> {
  const connection = await db.whatsAppConnection.findFirst({
    where: { id: connectionId, organizationId: orgId, status: 'connected' },
    select: { accessTokenEnc: true },
  })
  if (!connection?.accessTokenEnc) return null
  return decryptSecret(connection.accessTokenEnc)
}

/**
 * Resolución interna para WHATSPOWER/ULTRA (contrato de credenciales por org):
 * el llamador ya autenticado como SU organización solo puede resolver
 * credenciales DE SU ORGANIZACIÓN — el orgId siempre proviene de la
 * credencial, jamás del parámetro del cliente.
 */
export async function resolveInternalCredentials(orgId: string, phoneNumberId: string): Promise<{
  ok: boolean
  code?: 'not_found' | 'not_connected'
  connectionId?: string
  accessToken?: string
  wabaId?: string | null
  phoneNumber?: string
}> {
  const connection = await db.whatsAppConnection.findUnique({
    where: { phoneNumberId },
    select: {
      id: true, organizationId: true, status: true, accessTokenEnc: true, wabaId: true, phoneNumber: true,
    },
  })
  // Un phoneNumberId de OTRA organización se reporta como no encontrado
  // (404): el llamador no aprende que el número existe ni a quién pertenece.
  if (!connection || connection.organizationId !== orgId) return { ok: false, code: 'not_found' }
  if (connection.status !== 'connected') return { ok: false, code: 'not_connected' }
  const token = decryptSecret(connection.accessTokenEnc)
  if (!token) return { ok: false, code: 'not_connected' }
  return {
    ok: true,
    connectionId: connection.id,
    accessToken: token,
    wabaId: connection.wabaId,
    phoneNumber: connection.phoneNumber,
  }
}

/** Audit event (best-effort: el fallo del audit no rompe la operación). */
export async function auditEvent(
  connectionId: string | null,
  orgId: string,
  type: string,
  detail?: string,
): Promise<void> {
  try {
    await db.whatsAppConnectionEvent.create({
      data: { connectionId: connectionId ?? null, organizationId: orgId, type, detail: detail ?? null },
    })
  } catch (err) {
    console.error('[wa-connections] audit', err instanceof Error ? err.message : err)
  }
}

/**
 * Estado HMAC para Embedded Signup: el frontend inicia el flujo y el callback
 * se valida contra este estado firmado (anti-CSRF del flujo OAuth). El estado
 * expira (TTL 15 min) y es de un solo uso por organización.
 */
export function signSignupState(orgId: string, nonce: string, ttlMs = 15 * 60 * 1000): string {
  const appSecret = process.env.APP_SECRET || process.env.APP_ENCRYPTION_KEY || ''
  if (!appSecret) throw new Error('APP_SECRET no configurado ( requerido para firmar estado de Embedded Signup)')
  const exp = Date.now() + ttlMs
  const payload = `${orgId}.${nonce}.${exp}`
  const mac = createHmac('sha256', appSecret).update(payload).digest('hex')
  return `${payload}.${mac}`
}

export function verifySignupState(state: string): { ok: boolean; orgId?: string; error?: string } {
  const appSecret = process.env.APP_SECRET || process.env.APP_ENCRYPTION_KEY || ''
  if (!appSecret) return { ok: false, error: 'APP_SECRET no configurado' }
  const parts = state.split('.')
  if (parts.length !== 4) return { ok: false, error: 'Estado malformado' }
  const [orgId, nonce, exp, mac] = parts
  const expected = createHmac('sha256', appSecret).update(`${orgId}.${nonce}.${exp}`).digest('hex')
  if (mac.length !== expected.length || !timingSafeEq(mac, expected)) return { ok: false, error: 'Estado no válido' }
  if (Number(exp) < Date.now()) return { ok: false, error: 'Estado expirado: reinicia la conexión' }
  return { ok: true, orgId }
}

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Nonce cripto-aleatorio para el estado de Embedded Signup. */
export function newSignupNonce(): string {
  return randomBytes(12).toString('hex')
}

/** Config de la app para el launcher del frontend (sin secretos). */
export function embeddedSignupConfig(): { appId: string; configId?: string; graphVersion: string } | null {
  const app = metaAppConfig()
  if (!app) return null
  return { appId: app.appId, configId: app.configId, graphVersion: process.env.META_GRAPH_VERSION || 'v21.0' }
}
