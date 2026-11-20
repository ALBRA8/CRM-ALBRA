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

// (2026-11-21) Unificación de las 3 generaciones: ChannelConnection es la ÚNICA
// fuente de conexiones WhatsApp Cloud (provider 'meta_cloud', claves
// 'meta:whatsapp:<phoneNumberId>'). La tabla WhatsAppConnection fue retirada;
// sus filas históricas viven en ChannelConnection tras el backfill/migración.

interface WhatsAppCloudCredentialsBlob {
  accessToken?: string
  appSecret?: string | null
  webhookVerifyToken?: string | null
}

function parseCloudCredentials(credentialsEnc: string | null | undefined): WhatsAppCloudCredentialsBlob {
  const raw = decryptSecret(credentialsEnc)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as WhatsAppCloudCredentialsBlob
    if (parsed && typeof parsed === 'object') return parsed
    return { accessToken: raw }
  } catch {
    return { accessToken: raw }
  }
}

interface WhatsAppCloudMetadata {
  wabaId?: string | null
  phoneNumber?: string | null
  source?: string
  statusDetail?: string | null
}

function parseCloudMetadata(metadata: string | null | undefined): WhatsAppCloudMetadata {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as WhatsAppCloudMetadata
    if (parsed && typeof parsed === 'object') return parsed
    return {}
  } catch {
    return {}
  }
}

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
  return db.channelConnection.count({
    where: { organizationId: orgId, channel: 'whatsapp', provider: 'meta_cloud', status: { in: [...ACTIVE_STATUSES] } },
  })
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

  // (2.2) Chequeo PREVIO del límite (rápido, sin quemar llamadas a Graph cuando
  // el plan ya está agotado). NO es el chequeo de autoridad: la transacción de
  // abajo lo re-verifica atómicamente justo antes de crear.
  const preCount = await activeConnectionCount(orgId)
  const preGate = canAddConnection(org.plan, preCount)
  if (!preGate.allowed) {
    await auditEvent(null, orgId, 'plan_limit_blocked', `Plan ${org.plan}: límite ${preGate.limit} conexiones activas`)
    return {
      ok: false, code: 'plan_limit',
      message: `Tu plan (${preGate.planLabel}) permite ${preGate.limit} número(s) conectado(s). Libera un número o mejora de plan.`,
      limit: preGate.limit, planLabel: preGate.planLabel,
    }
  }

  // (2.1, auditoría 2026-11-11) Validación real del token contra Graph ANTES de
  // la transacción: la red JAMÁS se llama con el lock de escritura retenido.
  let resolvedPhone = phoneNumber ?? null
  let resolvedName = displayName ?? null
  let tokenError: string | null = null
  if (verifyAgainstGraph) {
    const identity = await inspectTokenIdentity(accessToken, fetchImpl)
    if (!identity.ok) {
      tokenError = `Token rechazado por Meta: ${identity.error}`
    } else {
      const info = await fetchPhoneNumberInfo(phoneNumberId, accessToken, fetchImpl)
      if (!info.ok) {
        tokenError = `El número ${phoneNumberId} no es operable con este token: ${info.error}`
      } else {
        resolvedPhone = info.displayPhoneNumber ?? info.phoneNumber ?? resolvedPhone
        resolvedName = info.verifiedName ?? resolvedName
      }
    }
  }
  if (tokenError) {
    await auditEvent(null, orgId, 'error', tokenError)
    return { ok: false, code: 'invalid_token', message: tokenError }
  }

  // (2.1/2.2, auditoría 2026-11-11) Límite del plan + unicidad + creación en UNA
  // transacción: el chequeo separado del create permitía la carrera — dos
  // Embedded Signup concurrentes superaban el límite del plan o se pasaban el
  // findUnique mutuamente (el UNIQUE(phoneNumberId) terminaba en 500 sin manejo).
  // Nota honesta (reauditoría ciclo 2): Prisma abre BEGIN DEFERRED, así que la
  // re-verificación del límite dentro del tx es best-effort; la cerradura
  // DEFINITIVA contra duplicados es el UNIQUE(phoneNumberId), cuyo P2002 se
  // traduce aquí a 'duplicate' sin filtrar la organización dueña.
  let outcome: { blocked: 'plan_limit'; gate: { limit: number; planLabel: string } } | { blocked: 'duplicate' } | { blocked: null; conn: { id: string; phoneNumber: string; status: string } }
  try {
    outcome = await db.$transaction(async (tx) => {
      // (1) Adquirir bloqueo exclusivo a nivel de organización para serializar
      // solicitudes simultáneas bajo concurrencia y evitar sobrepasar el límite del plan.
      await tx.organization.update({
        where: { id: orgId },
        data: { updatedAt: new Date() },
      })

      const activeCount = await tx.channelConnection.count({
        where: { organizationId: orgId, channel: 'whatsapp', provider: 'meta_cloud', status: { in: [...ACTIVE_STATUSES] } },
      })
      const gate = canAddConnection(org.plan, activeCount)
      if (!gate.allowed) return { blocked: 'plan_limit' as const, gate: { limit: gate.limit, planLabel: gate.planLabel } }
      const duplicate = await tx.channelConnection.findUnique({ where: { providerAccountKey: `meta:whatsapp:${phoneNumberId}` } })
      if (duplicate) return { blocked: 'duplicate' as const }
      const webhookVerifyToken = generateWebhookVerifyToken()
      const credentialsEnc = encryptSecret(JSON.stringify({
        accessToken,
        appSecret: metaAppSecret ?? null,
        webhookVerifyToken,
      }))
      if (!credentialsEnc) throw new Error('No se pudieron cifrar las credenciales canónicas')
      const conn = await tx.channelConnection.create({
        data: {
          organizationId: orgId,
          channel: 'whatsapp',
          provider: 'meta_cloud',
          providerAccountKey: `meta:whatsapp:${phoneNumberId}`,
          externalAccountId: phoneNumberId,
          displayName: resolvedName,
          status: 'connected',
          credentialsEnc,
          tokenExpiresAt: tokenExpiresAt ?? null,
          lastVerifiedAt: new Date(),
          metadata: JSON.stringify({
            wabaId: wabaId ?? null,
            phoneNumber: resolvedPhone ?? null,
            source,
            statusDetail: source === 'embedded_signup'
              ? 'Conectada vía Embedded Signup (flujo oficial Meta)'
              : 'Conectada manualmente por el administrador',
          }),
        },
      })

      // El evento de auditoría lo escribe auditEvent() al final (único escritor).
      return { blocked: null, conn: { id: conn.id, phoneNumber: resolvedPhone ?? phoneNumberId, status: conn.status } }
    })
  } catch (err) {
    // Carrera residual entre instancias: el UNIQUE(providerAccountKey) es la
    // cerradura definitiva. Sin filtrar a qué org pertenece (aislamiento).
    if ((err as { code?: string } | null)?.code === 'P2002') {
      return { ok: false, code: 'duplicate', message: 'Este número de WhatsApp ya está conectado a otra cuenta' }
    }
    throw err
  }
  if (outcome.blocked === 'plan_limit') {
    await auditEvent(null, orgId, 'plan_limit_blocked', `Plan ${org.plan}: límite ${outcome.gate.limit} conexiones activas`)
    return {
      ok: false, code: 'plan_limit',
      message: `Tu plan (${outcome.gate.planLabel}) permite ${outcome.gate.limit} número(s) conectado(s). Libera un número o mejora de plan.`,
      limit: outcome.gate.limit, planLabel: outcome.gate.planLabel,
    }
  }
  if (outcome.blocked === 'duplicate') {
    // No se revela a qué org pertenece (aislamiento: el llamador no aprende
    // datos de otras organizaciones).
    return { ok: false, code: 'duplicate', message: 'Este número de WhatsApp ya está conectado a otra cuenta' }
  }
  await auditEvent(outcome.conn.id, orgId, 'connected', `Número ${outcome.conn.phoneNumber} conectado (${source})`)
  return { ok: true, connectionId: outcome.conn.id, status: outcome.conn.status }
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
  const connection = await db.channelConnection.findFirst({
    where: { id: connectionId, organizationId: orgId, channel: 'whatsapp', provider: 'meta_cloud' },
  })
  if (!connection) return { ok: false, code: 'not_found', message: 'Conexión no encontrada' }
  if (connection.status === 'disconnected' || connection.status === 'revoked') {
    return { ok: true, status: connection.status }
  }
  const status = opts.revoked ? 'revoked' : 'disconnected'
  await db.$transaction(async (tx) => {
    const emptyCredentials = encryptSecret('{}')
    if (!emptyCredentials) throw new Error('No se pudieron invalidar las credenciales canónicas')
    await tx.channelConnection.update({
      where: { id: connection.id },
      data: {
        status,
        credentialsEnc: emptyCredentials, // destrucción del material sensible
        lastVerifiedAt: null,
      },
    })
    await tx.channelConnectionEvent.create({
      data: {
        organizationId: orgId,
        connectionId: connection.id,
        type: status,
        detail: opts.detail ?? (opts.revoked ? 'whatsapp_cloud_connection_revoked' : 'whatsapp_cloud_connection_disconnected'),
      },
    })
  })
  const meta = parseCloudMetadata(connection.metadata)
  await auditEvent(connection.id, orgId, status, `Número ${meta.phoneNumber ?? connection.externalAccountId}: ${status}`)
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
  const connection = await db.channelConnection.findUnique({
    where: { providerAccountKey: `meta:whatsapp:${phoneNumberId}` },
    select: { id: true, organizationId: true, status: true, credentialsEnc: true },
  })
  if (!connection) return null
  const creds = parseCloudCredentials(connection.credentialsEnc)
  return {
    id: connection.id,
    organizationId: connection.organizationId,
    status: connection.status,
    credentials: creds,
  }
}

/** Token en claro de una conexión (solo en memoria; NUNCA logueado). */
export async function resolveConnectionCredentials(orgId: string, connectionId: string): Promise<string | null> {
  const connection = await db.channelConnection.findFirst({
    where: { id: connectionId, organizationId: orgId, channel: 'whatsapp', provider: 'meta_cloud', status: 'connected' },
    select: { credentialsEnc: true },
  })
  if (!connection?.credentialsEnc) return null
  return parseCloudCredentials(connection.credentialsEnc).accessToken ?? null
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
  const connection = await db.channelConnection.findUnique({
    where: { providerAccountKey: `meta:whatsapp:${phoneNumberId}` },
    select: { id: true, organizationId: true, status: true, credentialsEnc: true, metadata: true, externalAccountId: true },
  })
  // Un phoneNumberId de OTRA organización se reporta como no encontrado
  // (404): el llamador no aprende que el número existe ni a quién pertenece.
  if (!connection || connection.organizationId !== orgId) return { ok: false, code: 'not_found' }
  if (connection.status !== 'connected') return { ok: false, code: 'not_connected' }
  const creds = parseCloudCredentials(connection.credentialsEnc)
  if (!creds.accessToken) return { ok: false, code: 'not_connected' }
  const meta = parseCloudMetadata(connection.metadata)
  return {
    ok: true,
    connectionId: connection.id,
    accessToken: creds.accessToken,
    wabaId: meta.wabaId ?? null,
    phoneNumber: meta.phoneNumber ?? connection.externalAccountId,
  }
}

/** Audit event canónico (best-effort: el fallo del audit no rompe la operación). */
export async function auditEvent(
  connectionId: string | null,
  orgId: string,
  type: string,
  detail?: string,
): Promise<void> {
  try {
    await db.channelConnectionEvent.create({
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

/**
 * (A1-11, auditoría 2026-11-11) Nonces de signup ya consumidos (TTL 15 min,
 * igual que la expiración del state): el state de Embedded Signup era
 * reutilizable dentro de su TTL; ahora el PRIMER canje lo consume.
 */
const usedSignupNonces = new Map<string, number>()
const SIGNUP_NONCE_TTL_MS = 15 * 60 * 1000

function consumeSignupNonce(nonce: string): boolean {
  const now = Date.now()
  for (const [k, t] of usedSignupNonces) if (now - t > SIGNUP_NONCE_TTL_MS) usedSignupNonces.delete(k)
  if (usedSignupNonces.has(nonce)) return false
  usedSignupNonces.set(nonce, now)
  return true
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
  // (A1-11) un solo uso: el primer canje consume el nonce del state
  if (!consumeSignupNonce(nonce)) return { ok: false, error: 'Estado ya utilizado: reinicia la conexión' }
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
