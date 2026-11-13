import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

const EVENT_KEY_PATTERN = /^[A-Za-z0-9:._+/=-]{1,255}$/
const EVENT_TYPE_PATTERN = /^[a-z0-9:._-]{1,80}$/
const PROCESSING_LEASE_MS = 5 * 60 * 1000

export type ChannelWebhookEventClaim = { id: string; claimToken: string }

/** A fencing token prevents a stale lease owner from closing a newer claim. */
export async function claimChannelWebhookEvent(input: { organizationId: string; connectionId: string; eventKey: string; eventType: string }): Promise<ChannelWebhookEventClaim | null> {
  if (!EVENT_KEY_PATTERN.test(input.eventKey) || !EVENT_TYPE_PATTERN.test(input.eventType)) throw new Error('Invalid channel webhook event identity')
  const connection = await db.channelConnection.findFirst({ where: { id: input.connectionId, organizationId: input.organizationId }, select: { id: true } })
  if (!connection) throw new Error('Channel webhook event connection not found')
  const now = new Date()
  const claimToken = randomUUID()
  try {
    const created = await db.channelWebhookEvent.create({ data: { organizationId: input.organizationId, connectionId: input.connectionId, eventKey: input.eventKey, eventType: input.eventType, status: 'processing', claimToken, attemptCount: 1, receivedAt: now }, select: { id: true } })
    return { id: created.id, claimToken }
  } catch (error) {
    const existing = await db.channelWebhookEvent.findUnique({ where: { connectionId_eventKey: { connectionId: input.connectionId, eventKey: input.eventKey } } })
    if (!existing) throw error
    if (existing.status === 'processed') return null
    const leaseExpired = existing.status === 'processing' && existing.updatedAt.getTime() < now.getTime() - PROCESSING_LEASE_MS
    if (existing.status !== 'failed' && !leaseExpired) return null
    const reclaimed = await db.channelWebhookEvent.updateMany({ where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt }, data: { status: 'processing', claimToken, attemptCount: { increment: 1 }, lastErrorCode: null, processedAt: null, receivedAt: now } })
    return reclaimed.count === 1 ? { id: existing.id, claimToken } : null
  }
}

export async function completeChannelWebhookEvent(claim: ChannelWebhookEventClaim) {
  return db.channelWebhookEvent.updateMany({ where: { id: claim.id, status: 'processing', claimToken: claim.claimToken }, data: { status: 'processed', processedAt: new Date(), lastErrorCode: null } })
}
export async function failChannelWebhookEvent(claim: ChannelWebhookEventClaim, errorCode: string) {
  const safeCode = /^[A-Z0-9_.-]{1,64}$/.test(errorCode) ? errorCode : 'PROCESSING_FAILED'
  return db.channelWebhookEvent.updateMany({ where: { id: claim.id, status: 'processing', claimToken: claim.claimToken }, data: { status: 'failed', lastErrorCode: safeCode } })
}
export async function getChannelWebhookEventStatus(connectionId: string, eventKey: string) {
  const event = await db.channelWebhookEvent.findUnique({ where: { connectionId_eventKey: { connectionId, eventKey } }, select: { status: true } })
  return event?.status ?? null
}
