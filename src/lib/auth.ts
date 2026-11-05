import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { can } from './rbac'
import { isSessionRevoked, scheduleRefreshSessionVersion } from './session-version'
import { logSecurityEvent } from './security-log'

/**
 * Autenticación JWT sin dependencias externas (HMAC-SHA256 firmado con APP_SECRET)
 * + hash de contraseñas con scrypt. Todos los payloads llevan orgId para el
 * aislamiento multi-tenant (bloqueador #1 de la auditoría).
 *
 * SEGURIDAD: NO hay secret fallback hardcodeado. Si APP_SECRET no está definido
 * en .env con longitud criptográfica, la autenticación falla ruidosamente
 * (hallazgo crítico #2 de la auditoría Antigravity: backdoor universal).
 */

function appSecret(): string {
  const secret = process.env.APP_SECRET
  if (!secret || secret.length < 24) {
    throw new Error(
      '[auth] APP_SECRET no configurado (mínimo 24 caracteres). Defínelo en .env con `openssl rand -hex 32`. Los secretos fallback fueron eliminados por seguridad.'
    )
  }
  return secret
}

export interface SessionPayload {
  userId: string
  orgId: string
  role: string
  email: string
  exp: number
  /** presence de token de descarga: SOLO válido en ?token= de endpoints de descarga */
  purpose?: 'download'
  /** B4: versión del usuario con la que se firmó el token (revocación de sesiones) */
  tokenVersion?: number
}

// ---------- Contraseñas (scrypt) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split(':')
    if (scheme !== 'scrypt' || !salt || !hash) return false
    const candidate = scryptSync(password, salt, 64)
    const expected = Buffer.from(hash, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

// ---------- Tokens ----------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function signToken(payload: Omit<SessionPayload, 'exp'>, days = 7): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body: SessionPayload = { ...payload, exp: Date.now() + days * 86400_000 }
  const claims = b64url(JSON.stringify(body))
  const sig = createHmac('sha256', appSecret()).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${sig}`
}

/**
 * Token de DESCARGA de corta vida (reparación integral B1).
 *
 * Motivo: el JWT de sesión (7 días) no debe colarse en URLs (?token=) porque
 * queda en historial del navegador, logs de proxy y cabecera Referer. Para las
 * descargas directas (<a href>, window.open) se emite un token dedicado con
 * `purpose: 'download'` y expiración de 5 minutos; los endpoints de descarga
 * lo aceptan solo en `?token=` y NUNCA fuera de ellos.
 */
export const DOWNLOAD_TOKEN_TTL_SECONDS = 300

export function signDownloadToken(payload: Omit<SessionPayload, 'exp' | 'purpose'>, ttlSeconds = DOWNLOAD_TOKEN_TTL_SECONDS): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body: SessionPayload = { ...payload, purpose: 'download', exp: Date.now() + ttlSeconds * 1000 }
  const claims = b64url(JSON.stringify(body))
  const sig = createHmac('sha256', appSecret()).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${sig}`
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    const [header, claims, sig] = token.split('.')
    if (!header || !claims || !sig) return null
    const expected = createHmac('sha256', appSecret()).update(`${header}.${claims}`).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as SessionPayload
    if (!payload.exp || payload.exp < Date.now()) return null
    if (!payload.orgId || !payload.userId) return null // sesión multi-tenant estricta
    return payload
  } catch {
    return null
  }
}

// ---------- Extracción de sesión en rutas API ----------

export interface AuthContext {
  userId: string
  orgId: string
  role: string
  email: string
  isAdmin: boolean
  /** B4: tokenVersion del usuario embebida en el JWT (para heredarla en download-tokens) */
  tokenVersion?: number
}

/** Cookie de sesión httpOnly (mitigación XSS: el JWT no necesita vivir en localStorage). */
export const SESSION_COOKIE = 'albra_session'

/**
 * Opciones de autenticación por ruta (reparación integral B1).
 *
 * `allowQueryToken` es un OPT-IN EXPLÍCITO: el JWT ya NO se acepta por
 * `?token=` en todas las rutas (quedaba expuesto en historial, logs y Referer).
 * Solo los endpoints de DESCARGA (export/csv, reports/pdf, reports/excel,
 * quotes/pdf, backup) lo permiten, y allí aceptan además el download-token de
 * corta vida (`purpose: 'download'`, 5 min) emitido por /api/auth/download-token.
 */
export interface GetAuthOptions {
  allowQueryToken?: boolean
}

/** Opciones para endpoints de descarga: única vía legítima de ?token=. */
export const DOWNLOAD_AUTH_OPTS: GetAuthOptions = { allowQueryToken: true }

function toAuthContext(session: SessionPayload): AuthContext | null {
  // B4 revocación: si el usuario ya lleva una versión mayor que la firmada en
  // el token (logout / reset de contraseña / desactivación), la sesión muere.
  if (isSessionRevoked(session.userId, session.tokenVersion)) return null
  // Convergencia multi-proceso: refresco perezoso de la versión vigente.
  scheduleRefreshSessionVersion(session.userId)
  return {
    userId: session.userId,
    orgId: session.orgId,
    role: session.role,
    email: session.email,
    // superadmin es administrador también DENTRO de su organización
    // (superconjunto de owner), además de su rol de plataforma.
    isAdmin: session.role === 'owner' || session.role === 'admin' || session.role === 'superadmin',
    tokenVersion: session.tokenVersion,
  }
}

export function getAuth(req: NextRequest, opts: GetAuthOptions = {}): AuthContext | null {
  const allowQueryToken = opts.allowQueryToken === true

  // 1) Bearer (pestaña activa, evita conflictos multi-cuenta)
  // 2) cookie httpOnly (persistencia tras F5 sin token en localStorage)
  const header = req.headers.get('authorization') || ''
  let token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) token = req.cookies.get(SESSION_COOKIE)?.value ?? null

  if (token) {
    const session = verifyToken(token)
    if (!session) return null
    // Un download-token NUNCA autentica por Bearer/cookie ni en rutas
    // normales: solo por ?token= en endpoints de descarga.
    if (session.purpose === 'download') return null
    return toAuthContext(session)
  }

  // 3) ?token= SOLO con opt-in explícito (endpoints de descarga). Acepta el JWT
  // de sesión por compatibilidad con los enlaces ya emitidos, y el
  // download-token de corta vida como vía recomendada.
  if (allowQueryToken) {
    const queryToken = new URL(req.url).searchParams.get('token')
    if (queryToken) {
      const session = verifyToken(queryToken)
      if (!session) return null
      return toAuthContext(session)
    }
  }

  return null
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Requiere sesión; lanza HttpError 401 si no hay. */
export function requireAuth(req: NextRequest, opts: GetAuthOptions = {}): AuthContext {
  const auth = getAuth(req, opts)
  if (!auth) throw new HttpError(401, 'Token de autorización requerido')
  return auth
}

/** Requiere rol admin/owner (para config sensible como Nicho, equipo, integraciones). */
export function requireAdmin(req: NextRequest, opts: GetAuthOptions = {}): AuthContext {
  const auth = requireAuth(req, opts)
  if (!auth.isAdmin) throw new HttpError(403, 'Se requieren permisos de administrador')
  return auth
}

/**
 * Requiere el rol de plataforma `superadmin` (plano de control multi-organización).
 *
 * Distinto de requireAdmin: un owner de UNA organización no ve las demás.
 * La autoridad cross-org vive SOLO aquí; las rutas /api/super/* son las únicas
 * que consultan la base de datos SIN filtrar por organizationId, y siempre
 * detrás de esta guardia. Nadie puede adquirir el rol por API (el ciclo de
 * vida de usuarios prohibe crear/promover superadmin): solo existe por
 * promoción directa en BD (scripts/promote-superadmin.mjs).
 */
export function requireSuperAdmin(req: NextRequest, opts: GetAuthOptions = {}): AuthContext {
  const auth = requireAuth(req, opts)
  if (auth.role !== 'superadmin') {
    throw new HttpError(403, 'Se requiere rol de superadministrador de plataforma')
  }
  return auth
}

/**
 * Requiere una capacidad RBAC concreta (Fase 2). Autoridad final del servidor:
 * la UI puede ocultar botones, pero aquí se decide de verdad. Soporta
 * comodines ('settings.*' concede 'settings.write').
 */
export function requirePermission(req: NextRequest, capability: string, opts: GetAuthOptions = {}): AuthContext {
  const auth = requireAuth(req, opts)
  if (!can(auth.role, capability)) {
    // B8: observabilidad de seguridad — denegación RBAC (403) registrada.
    logSecurityEvent('rbac.denied', { userId: auth.userId, orgId: auth.orgId, role: auth.role, capability })
    throw new HttpError(403, `Sin permiso para esta acción (${capability})`)
  }
  return auth
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'org'
}
