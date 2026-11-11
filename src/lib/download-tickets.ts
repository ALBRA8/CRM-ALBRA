/**
 * download-tickets.ts — Descargas directas seguras SIN JWT en la URL
 * (reparación integral 2026-11-06 — orden §2: eliminar el uso genérico de JWT
 * en URL; los enlaces de descarga usan tickets de un solo uso y corta vida).
 *
 * Contrato:
 *  - issue(): crea ticket aleatorio de 256 bits; solo se guarda su SHA-256.
 *  - redeem(): cambia ticket por AuthContext UNA sola vez; TTL por defecto 60 s.
 *  - Map en memoria por proceso (los tickets no son datos persistentes);
 *    en multi-instancia, usar el mismo enfoque con store compartido.
 */
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import type { AuthContext } from './auth'

interface TicketRecord {
  ctx: AuthContext
  expiresAt: number
  used: boolean
}

const TTL_MS = 60_000
const MAX_OUTSTANDING_PER_USER = 20

const tickets = new Map<string, TicketRecord>() // hash → record

function hashTicket(ticket: string): string {
  return createHash('sha256').update(ticket, 'utf8').digest('hex')
}

function sweep(now: number): void {
  for (const [h, rec] of tickets) {
    if (rec.used || rec.expiresAt < now) tickets.delete(h)
  }
}

export function issueDownloadTicket(ctx: AuthContext, ttlMs: number = TTL_MS): { ticket: string; expiresInSec: number } {
  const now = Date.now()
  sweep(now)
  // Anti-abuso: tope de tickets vivos por usuario
  let outstanding = 0
  for (const rec of tickets.values()) {
    if (!rec.used && rec.ctx.userId === ctx.userId && rec.expiresAt > now) outstanding++
  }
  if (outstanding >= MAX_OUTSTANDING_PER_USER) {
    throw new Error('Demasiados tickets de descarga activos; reintenta en un minuto')
  }
  const ticket = randomBytes(32).toString('hex')
  tickets.set(hashTicket(ticket), { ctx: { ...ctx }, expiresAt: now + ttlMs, used: false })
  return { ticket, expiresInSec: Math.floor(ttlMs / 1000) }
}

/** Canjea un ticket (un solo uso). null si es inválido, expirado o reutilizado. */
export function redeemDownloadTicket(ticket: string): AuthContext | null {
  if (typeof ticket !== 'string' || ticket.length < 32 || ticket.length > 128) return null
  const h = hashTicket(ticket)
  const rec = tickets.get(h)
  if (!rec || rec.used || rec.expiresAt < Date.now()) {
    tickets.delete(h)
    return null
  }
  rec.used = true
  tickets.delete(h) // el canje consume el registro (un solo uso estricto)
  // Comparación timing-safe defensiva del hash guardado (defensa en profundidad)
  const a = Buffer.from(h)
  const b = Buffer.from(hashTicket(ticket))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return rec.ctx
}
