import { db } from './db'

/**
 * Timeline unificado por registro (feature #3 del plan aprobado, inspirado en Twenty).
 * Todas las interacciones — notas, llamadas, mensajes de canales, cotizaciones,
 * cambios de etapa, acciones del agente — se anclan cronológicamente aquí.
 */

export interface TimelineEventInput {
  orgId: string
  clientId?: string | null
  opportunityId?: string | null
  quoteId?: string | null
  reservationId?: string | null
  type: string
  title: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  source?: string
  userId?: string | null
}

export async function recordTimelineEvent(input: TimelineEventInput) {
  try {
    await db.timelineEvent.create({
      data: {
        organizationId: input.orgId,
        clientId: input.clientId || null,
        opportunityId: input.opportunityId || null,
        quoteId: input.quoteId || null,
        reservationId: input.reservationId || null,
        type: input.type,
        title: input.title,
        description: input.description || null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        source: input.source || 'manual',
        userId: input.userId || null,
      },
    })
  } catch (err) {
    // El timeline nunca debe romper el flujo principal
    console.error('[timeline] no se pudo registrar el evento', err)
  }
}
