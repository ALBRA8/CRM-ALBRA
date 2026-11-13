import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { can } from './rbac'
import { redeemDownloadTicket } from './download-tickets'
import { db } from './db'

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
  /** Epoch ms de emisión (para invalidación tras cambio de contraseña). */
  iat?: number
  /**
   * tokenVersion vigente al firmar el token (revocación PERSISTENTE, orden §2.A).
   * La guarda async la coteja contra la BD en cada petición: si difiere, el
   * token está revocado (reset de contraseña, desactivación, cambio de rol,
   * logout global). Tokens previos sin `tv` se tratan como versión 0 — los
   * usuarios nuevos arrancan en 0, así que la compatibilidad se conserva y la
   * primera revocación los invalida también.
   */
  tv?: number
  /**
   * (OLEADA 2) Claim de TICKET 2FA: true = token provisional de 5 minutos
   * emitido tras validar contraseña cuando el usuario tiene 2FA activo. NO es
   * una sesión: solo sirve para POST /api/auth/2fa/verify. getAuth() lo
   * rechaza — un ticket MFA jamás autentica operaciones de negocio.
   */
  mfa?: boolean
  exp: number
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
  const body: SessionPayload = { ...payload, iat: Date.now(), exp: Date.now() + days * 86400_000 }
  const claims = b64url(JSON.stringify(body))
  const sig = createHmac('sha256', appSecret()).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${sig}`
}

/**
 * (OLEADA 2) Ticket MFA: credencial PROVISIONAL de corta vida (5 min) que
 * acredita "contraseña válida para este usuario". Se canjea por una sesión
 * real solo presentando además el segundo factor (TOTP o código de
 * recuperación). Claim mfa:true — getAuth() lo rechaza como sesión.
 */
export function signMfaTicket(
  user: { userId: string; orgId: string; role: string; email: string },
  minutes = 5
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body: SessionPayload = {
    ...user,
    mfa: true,
    tv: undefined,
    iat: Date.now(),
    exp: Date.now() + minutes * 60_000,
  }
  const claims = b64url(JSON.stringify(body))
  const sig = createHmac('sha256', appSecret()).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${sig}`
}

/**
 * (OLEADA 2) Verifica un TICKET MFA (no una sesión): firma, vigencia y claim.
 * Devuelve el payload solo si es un ticket MFA legítimo.
 */
export function verifyMfaTicket(token: string): SessionPayload | null {
  const payload = verifyToken(token)
  if (!payload || payload.mfa !== true) return null
  return payload
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
  /** tokenVersion embebida en el JWT (para heredarla en tickets de descarga). */
  tv?: number
}

/** Cookie de sesión httpOnly (mitigación XSS: el JWT no necesita vivir en localStorage). */
export const SESSION_COOKIE = 'albra_session'

export function getAuth(req: NextRequest): AuthContext | null {
  const header = req.headers.get('authorization') || ''
  // Prioridad: 1) Bearer (pestaña activa, evita conflictos multi-cuenta),
  // 2) cookie httpOnly (persistencia tras F5 sin token en localStorage).
  // (reparación integral 2026-11-06) El JWT YA NO se acepta en la URL (?token=):
  // las descargas directas usan tickets de un solo uso (?ticket=, ver
  // download-tickets.ts y POST /api/download-ticket). Un JWT en URL queda
  // registrado en proxies/historial y se reenvía por Referer.
  let token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) token = req.cookies.get(SESSION_COOKIE)?.value ?? null
  let ctx: AuthContext | null = null
  if (token) {
    const session = verifyToken(token)
    // (OLEADA 2) Un ticket MFA NO es una sesión: si alguien intenta usarlo en
    // una API de negocio, se ignora (fail-closed) — debe canjearse en
    // /api/auth/2fa/verify con el segundo factor.
    if (session && session.mfa === true) return null
    if (session) {
      ctx = {
        userId: session.userId,
        orgId: session.orgId,
        role: session.role,
        email: session.email,
        tv: session.tv,
        // superadmin es administrador también DENTRO de su organización
        // (superconjunto de owner), además de su rol de plataforma.
        isAdmin: session.role === 'owner' || session.role === 'admin' || session.role === 'superadmin',
      }
      // (segunda reparación) La revocación PERSISTENTE por tokenVersion la
      // aplica assertSessionState() — asíncrona y contra BD — invocada por
      // requireAuth/requireAdmin/requireSuperAdmin/requirePermission.
      // getAuth() sigue siendo síncrono para usos internos (tickets).
    }
  }
  if (!ctx) {
    // Descargas directas: ticket de un solo uso (60 s) canjeable por contexto.
    const url = new URL(req.url)
    const ticket = url.searchParams.get('ticket')
    if (ticket) ctx = redeemDownloadTicket(ticket)
  }
  return ctx
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * (segunda reparación — orden §2.A) Verificación del ESTADO DE SESIÓN contra la
 * base de datos, autoridad única compartida por todas las instancias:
 *  1. el usuario debe existir;
 *  2. debe estar activo (la desactivación de un empleado corta su sesión al instante);
 *  3. la `tv` del JWT debe coincidir con `tokenVersion` vigente (revocación por
 *     reset de contraseña, cambio de rol o logout global);
 *  4. la organización del token debe seguir siendo la del usuario (el JWT no
 *     puede "viajar" entre organizaciones).
 *
 * FAIL-CLOSED: cualquier fallo de BD NO autoriza — la excepción sube y la ruta
 * responde 500 sin ejecutar la operación de negocio.
 */
export async function assertSessionState(ctx: AuthContext): Promise<AuthContext> {
  const user = await db.user.findUnique({
    where: { id: ctx.userId },
    select: { isActive: true, tokenVersion: true, organizationId: true, role: true },
  })
  if (!user || !user.isActive) {
    throw new HttpError(401, 'Sesión revocada o usuario inactivo')
  }
  const currentVersion = user.tokenVersion ?? 0
  if ((ctx.tv ?? 0) !== currentVersion) {
    throw new HttpError(401, 'Sesión revocada: vuelve a iniciar sesión')
  }
  // El rol vigente en BD es la autoridad: cambios de rol invalidan el token anterior.
  if (user.role !== ctx.role) {
    throw new HttpError(401, 'El rol de la cuenta cambió. Vuelve a iniciar sesión')
  }
  if (user.organizationId !== ctx.orgId) {
    // Única excepción cross-tenant: cuenta cuyo rol ACTUAL en BD es superadmin.
    // El orgId del token representa el contexto activo, nunca una membresía del usuario.
    if (user.role !== 'superadmin') {
      throw new HttpError(401, 'Sesión inválida para esta organización')
    }
    const activeOrg = await db.organization.findUnique({
      where: { id: ctx.orgId },
      select: { isActive: true },
    })
    if (!activeOrg?.isActive) {
      throw new HttpError(403, 'La organización seleccionada no existe o está inactiva')
    }
  }
  return ctx
}

/** Requiere sesión VÁLIDA Y VIGENTE; lanza HttpError 401 si no. (async: consulta BD) */
export async function requireAuth(req: NextRequest): Promise<AuthContext> {
  const auth = getAuth(req)
  if (!auth) throw new HttpError(401, 'Token de autorización requerido')
  return await assertSessionState(auth)
}

/** Requiere rol admin/owner con sesión vigente. (async: consulta BD) */
export async function requireAdmin(req: NextRequest): Promise<AuthContext> {
  const auth = await requireAuth(req)
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
export async function requireSuperAdmin(req: NextRequest): Promise<AuthContext> {
  const auth = await requireAuth(req)
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
export async function requirePermission(req: NextRequest, capability: string): Promise<AuthContext> {
  const auth = await requireAuth(req)
  if (!can(auth.role, capability)) {
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
