import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'

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
}

/** Cookie de sesión httpOnly (mitigación XSS: el JWT no necesita vivir en localStorage). */
export const SESSION_COOKIE = 'albra_session'

export function getAuth(req: NextRequest): AuthContext | null {
  const header = req.headers.get('authorization') || ''
  // Prioridad: 1) Bearer (pestaña activa, evita conflictos multi-cuenta),
  // 2) cookie httpOnly (persistencia tras F5 sin token en localStorage),
  // 3) ?token= (descargas directas CSV/PDF/backup).
  let token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) token = req.cookies.get(SESSION_COOKIE)?.value ?? null
  if (!token) {
    // endpoints de descarga (csv/backup/pdf) admiten ?token=
    const url = new URL(req.url)
    token = url.searchParams.get('token')
  }
  if (!token) return null
  const session = verifyToken(token)
  if (!session) return null
  return {
    userId: session.userId,
    orgId: session.orgId,
    role: session.role,
    email: session.email,
    isAdmin: session.role === 'owner' || session.role === 'admin',
  }
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Requiere sesión; lanza HttpError 401 si no hay. */
export function requireAuth(req: NextRequest): AuthContext {
  const auth = getAuth(req)
  if (!auth) throw new HttpError(401, 'Token de autorización requerido')
  return auth
}

/** Requiere rol admin/owner (para config sensible como Nicho, equipo, integraciones). */
export function requireAdmin(req: NextRequest): AuthContext {
  const auth = requireAuth(req)
  if (!auth.isAdmin) throw new HttpError(403, 'Se requieren permisos de administrador')
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
