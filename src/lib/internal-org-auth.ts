/**
 * internal-org-auth.ts — Autenticación de servicio POR ORGANIZACIÓN (contrato
 * compartido con WHATSPOWER §1 y ULTRA: mismo formato INTERNAL_API_KEYS).
 *
 * "orgId:secreto[:rol],orgId2:secreto2[:rol]" → identidad de organización.
 * El secreto global (INTERNAL_API_SECRET) solo resuelve a la organización
 * "default" con rol admin por compatibilidad operativa histórica.
 *
 * REGLA DE AISLAMIENTO (decisión 2026-11-11, punto 8): un llamador
 * autenticado con la credencial de SU organización JAMÁS puede resolver
 * credenciales ni operar conexiones de otra organización. Toda ruta interna
 * que entregue material sensible debe filtrar por el orgId RESUELTO DE LA
 * CREDENCIAL — jamás por un organization_id recibido por parámetro o body
 * (cierre de la excepción de seguridad "confiar en el org del cliente").
 *
 * Comparación SIEMPRE en tiempo constante (timingSafeEqual) — fail-closed
 * sin INTERNAL_API_KEYS ni INTERNAL_API_SECRET configurados.
 */
import { timingSafeEqual } from 'node:crypto'

export type InternalRole = 'admin' | 'agent'

export interface InternalIdentity {
  orgId: string
  role: InternalRole
  source: 'keys' | 'legacy'
}

interface InternalKeyEntry {
  orgId: string
  secret: string
  role: InternalRole
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba)
    return false
  }
  return timingSafeEqual(ba, bb)
}

export function parseInternalKeys(raw: string | undefined): { entries: InternalKeyEntry[]; skipped: number } {
  const entries: InternalKeyEntry[] = []
  let skipped = 0
  if (!raw) return { entries, skipped }
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const pieces = trimmed.split(':')
    if (pieces.length < 2 || pieces.length > 3) { skipped++; continue }
    const [orgId, secret, role] = pieces
    if (!orgId || !secret || !/^[A-Za-z0-9_-]{1,64}$/.test(orgId)) { skipped++; continue }
    if (secret.length < 16) { skipped++; continue } // secretos débiles se rechazan al parsear
    if (orgId === '__legacy__') { skipped++; continue } // espacio RESERVADO (contrato §4)
    entries.push({ orgId, secret, role: role === 'admin' ? 'admin' : 'agent' })
  }
  return { entries, skipped }
}

/**
 * Resuelve la identidad de organización a partir del header Authorization.
 * Devuelve null si no hay identidad válida (la ruta debe responder 401/403).
 */
export function resolveInternalIdentity(authHeader: string | undefined): InternalIdentity | null {
  const legacySecret = process.env.INTERNAL_API_SECRET
  if (legacySecret && authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length)
    // El legado solo es válido cuando no hay claves por-org configuradas
    // (misma semántica del contrato WHATSPOWER §1: las claves por-org tienen
    // prioridad; el secreto global resuelve a "default").
    if (safeEqual(token, legacySecret)) {
      return { orgId: 'default', role: 'admin', source: 'legacy' }
    }
  }
  const { entries } = parseInternalKeys(process.env.INTERNAL_API_KEYS)
  if (!entries.length) return null
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  for (const entry of entries) {
    if (safeEqual(token, entry.secret)) {
      return { orgId: entry.orgId, role: entry.role, source: 'keys' }
    }
  }
  return null
}

/** Guardia: identidad requerida (401 si falta). */
export function requireInternalIdentity(authHeader: string | undefined): InternalIdentity {
  const identity = resolveInternalIdentity(authHeader)
  if (!identity) {
    throw Object.assign(new Error('Credencial de organización requerida (Bearer)'), { status: 401 })
  }
  return identity
}

/** Guardia: identidad con rol admin de su organización (403 si es agent). */
export function requireInternalAdmin(authHeader: string | undefined): InternalIdentity {
  const identity = requireInternalIdentity(authHeader)
  if (identity.role !== 'admin') {
    throw Object.assign(new Error('Se requiere credencial de servicio con rol admin'), { status: 403 })
  }
  return identity
}
