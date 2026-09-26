import { parseJson, str } from './shared'
import { serializeClientRef } from './clients'

/**
 * Reservas: `serviceType` y `notes` del frontend se guardan junto al texto de
 * descripción como envelope JSON en la columna `description`:
 * `{ text, serviceType, notes }`.
 */

export interface ReservationMeta {
  text: string | null
  serviceType: string | null
  notes: string | null
}

export function parseResMeta(description: string | null): ReservationMeta {
  const parsed = parseJson<Partial<ReservationMeta>>(description, {})
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      text: parsed.text ?? null,
      serviceType: parsed.serviceType ?? null,
      notes: parsed.notes ?? null,
    }
  }
  return { text: description, serviceType: null, notes: null }
}

export function buildResMeta(body: Record<string, unknown>, previous?: ReservationMeta): string {
  const meta: ReservationMeta = {
    text: 'description' in body ? str(body.description) : (previous?.text ?? null),
    serviceType: 'serviceType' in body ? str(body.serviceType) : (previous?.serviceType ?? null),
    notes: 'notes' in body ? str(body.notes) : (previous?.notes ?? null),
  }
  return JSON.stringify(meta)
}

interface ResRecordLike {
  id: string
  title: string
  description: string | null
  startsAt: Date
  endsAt: Date | null
  status: string
  location: string | null
  client?: { id: string; name: string; email: string | null; phone: string | null } | null
  createdAt: Date
  updatedAt: Date
}

export function durationMinutes(startsAt: Date, endsAt: Date | null): number {
  if (!endsAt) return 60
  const mins = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)
  return mins > 0 ? mins : 60
}

export function serializeReservation(r: ResRecordLike): Record<string, unknown> {
  const meta = parseResMeta(r.description)
  return {
    id: r.id,
    title: r.title,
    description: meta.text,
    serviceType: meta.serviceType,
    date: r.startsAt,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    duration: durationMinutes(r.startsAt, r.endsAt),
    status: r.status,
    location: r.location,
    notes: meta.notes,
    client: r.client ? serializeClientRef(r.client) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}
