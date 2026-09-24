import { NextRequest, NextResponse } from 'next/server'
import { HttpError } from './auth'
import { recordTimelineEvent } from './timeline'

/**
 * Helpers compartidos por todas las rutas API:
 * - Manejo uniforme de errores
 * - Validación básica
 * - Registro de actividad y eventos de timeline (multi-tenant)
 */

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  const message = err instanceof Error ? err.message : 'Error interno del servidor'
  console.error('[api]', err)
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function handle(fn: () => Promise<NextResponse>) {
  try {
    return await fn()
  } catch (err) {
    return errorResponse(err)
  }
}

export function requireFields(body: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length) {
    throw new HttpError(400, `Campos requeridos faltantes: ${missing.join(', ')}`)
  }
}

export function parseIntParam(req: NextRequest, name: string, fallback: number, min = 1, max = 100): number {
  const raw = new URL(req.url).searchParams.get(name)
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, min), max)
}

export function paginationMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

/** Registro de actividad (auditoría) + evento de timeline en un solo paso */
export async function auditAndTimeline(opts: {
  orgId: string
  userId?: string | null
  action: string
  entity: string
  entityId?: string
  details?: Record<string, unknown>
  clientId?: string | null
  opportunityId?: string | null
  quoteId?: string | null
  reservationId?: string | null
  timelineType?: string
  timelineTitle?: string
  timelineDescription?: string
  source?: string
}) {
  const { orgId, userId, action, entity, entityId, details, clientId, opportunityId, quoteId, reservationId, timelineType, timelineTitle, timelineDescription, source } = opts
  const { db } = await import('./db')
  await db.activityLog.create({
    data: { organizationId: orgId, userId, action, entity, entityId, details: details ? JSON.stringify(details) : undefined },
  })
  if (timelineTitle) {
    await recordTimelineEvent({
      orgId,
      clientId: clientId ?? null,
      opportunityId: opportunityId ?? null,
      quoteId: quoteId ?? null,
      reservationId: reservationId ?? null,
      type: timelineType || 'system',
      title: timelineTitle,
      description: timelineDescription,
      source: source || (userId ? 'manual' : 'automation'),
      userId,
      metadata: details,
    })
  }
}
