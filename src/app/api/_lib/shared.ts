import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

/**
 * Helpers compartidos para las rutas API del backend core (Task 2-a).
 * Archivo privado (prefijo _) — no expone rutas.
 */

export type Body = Record<string, unknown>

export async function readBody(req: NextRequest): Promise<Body> {
  try {
    const data = await req.json()
    return typeof data === 'object' && data !== null ? (data as Body) : {}
  } catch {
    return {}
  }
}

/** Lee un parámetro de query ya recortado (null si vacío). */
export function qparam(req: NextRequest, name: string): string | null {
  return str(req.nextUrl.searchParams.get(name))
}

export function str(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

export function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export function dateOrNull(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function isObjArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null)
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** Etiqueta corta de mes en español para gráficas (index 0 = enero). */
export const MONTH_LABELS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(d: Date): string {
  return `${MONTH_LABELS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

/** Normaliza el tipo de transacción al vocabulario del frontend (ingreso|egreso). */
export function normalizeTxType(v: unknown, fallback = 'ingreso'): string {
  const s = str(v)?.toLowerCase()
  if (!s) return fallback
  if (s === 'income' || s === 'ingreso') return 'ingreso'
  if (s === 'expense' || s === 'egreso' || s === 'gasto') return 'egreso'
  return fallback
}

// ---------- Compat: helpers de respuesta y validación ----------
// (añadidos durante la integración — reexportan la convención estándar del proyecto)

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

/**
 * Respuesta JSON que además fija la cookie de sesión httpOnly (cierre Fase 1
 * del plan de endurecimiento): SameSite=Lax mitiga CSRF, Secure en producción
 * y 7 días de vida = TTL del JWT (signToken). El Bearer en memoria sigue
 * siendo válido (modo dual), pero tras F5 la cookie autentica sin exponer el
 * token a JavaScript (mitiga robo de sesión por XSS).
 */
export function jsonWithSession(data: unknown, token: string): NextResponse {
  const res = NextResponse.json(data)
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  return res
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    // Compatible con HttpError de '@/lib/auth' (otra clase, mismo contrato status/message)
    const status = (err as { status?: unknown })?.status
    const message = (err as { message?: unknown })?.message
    if (err instanceof HttpErrorLike || (typeof status === 'number' && typeof message === 'string')) {
      return NextResponse.json({ error: message }, { status: typeof status === 'number' ? status : 500 })
    }
    const fallback = err instanceof Error ? err.message : 'Error interno del servidor'
    console.error('[api]', err)
    return NextResponse.json({ error: fallback }, { status: 500 })
  }
}

/** Estructura mínima compatible con HttpError de '@/lib/auth' sin importarlo. */
export class HttpErrorLike extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function requireFields(body: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length) {
    throw new HttpErrorLike(400, `Campos requeridos faltantes: ${missing.join(', ')}`)
  }
}

export function bool(v: unknown, fallback = false): boolean {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'boolean') return v
  const s = String(v).toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}
