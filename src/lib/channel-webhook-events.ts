import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

const EVENT_KEY_PATTERN = /^[A-Za-z0-9:._+/=-]{1,255}$/
const EVENT_TYPE_PATTERN = /^[a-z0-9:._-]{1,80}$/
const PROCESSING_LEASE_MS = 5 * 60 * 1000

export type ChannelWebhookEventClaim = { id: string; claimToken: string }

/**
 * Resolves the legacy Telegram bot to its canonical connection identity.
 * The key matches the channel backfill format, so repeated webhook deliveries
 * and a later backfill converge on the same connection instead of creating
 * competing ledgers. Existing ownership is always checked fail-closed.
 */
export async function getOrCreateTelegramWebhookConnection(input: {
  organizationId: string
  botId: string
  credentialsEnc: string
}): Promise<{ id: string }> {
  if (!/^\d{1,20}$/.test(input.botId)) throw new Error('Invalid Telegram bot identity')
  const providerAccountKey = `telegram:bot:${input.botId}`
  const existing = await db.channelConnection.findUnique({
    where: { providerAccountKey },
    select: { id: true, organizationId: true, channel: true, provider: true, externalAccountId: true },
  })
  if (existing) {
    if (existing.organizationId !== input.organizationId || existing.channel !== 'telegram' ||
      existing.provider !== 'telegram_bot' || existing.externalAccountId !== input.botId) {
      throw new Error('Telegram bot connection ownership conflict')
    }
    return { id: existing.id }
  }

  try {
    const created = await db.channelConnection.create({
      data: {
        organizationId: input.organizationId,
        channel: 'telegram',
        provider: 'telegram_bot',
        providerAccountKey,
        externalAccountId: input.botId,
        status: 'pending',
        credentialsEnc: input.credentialsEnc,
        metadata: JSON.stringify({ legacyWebhook: true, source: 'Integration.telegram' }),
      },
      select: { id: true },
    })
    return created
  } catch (error) {
    // A concurrent webhook/backfill may have won the unique-key race.
    const raced = await db.channelConnection.findUnique({
      where: { providerAccountKey },
      select: { id: true, organizationId: true, channel: true, provider: true, externalAccountId: true, status: true },
    })
    if (!raced || raced.organizationId !== input.organizationId || raced.channel !== 'telegram' ||
      raced.provider !== 'telegram_bot' || raced.externalAccountId !== input.botId) throw error
    return { id: raced.id }
  }
}

/**
 * Resolves the legacy Facebook Page to the canonical Messenger connection.
 * The provider key matches the conservative backfill identity.
 */
export async function getOrCreateMessengerWebhookConnection(input: {
  organizationId: string
  pageId: string
  credentialsEnc: string
}): Promise<{ id: string }> {
  if (!/^\d{1,30}$/.test(input.pageId) || !input.organizationId || !input.credentialsEnc) {
    throw new Error('Invalid Messenger Page identity')
  }
  const providerAccountKey = `meta:messenger:${input.pageId}`
  const existing = await db.channelConnection.findUnique({
    where: { providerAccountKey },
    select: { id: true, organizationId: true, channel: true, provider: true, externalAccountId: true, status: true },
  })
  if (existing) {
    if (existing.organizationId !== input.organizationId || existing.channel !== 'messenger' ||
      existing.provider !== 'meta_graph' || existing.externalAccountId !== input.pageId) {
      throw new Error('Messenger Page connection ownership conflict')
    }
    // Never revive a connection explicitly disconnected/revoked by an operator.
    // Pending and already-connected legacy connections may be verified by this
    // signed Page webhook; outbound dispatch remains separately feature-gated.
    if (existing.status === 'pending' || existing.status === 'connected') {
      await db.channelConnection.update({
        where: { id: existing.id },
        data: { status: 'connected', credentialsEnc: input.credentialsEnc, lastVerifiedAt: new Date(), lastErrorCode: null },
      })
    }
    return { id: existing.id }
  }

  try {
    return await db.channelConnection.create({
      data: {
        organizationId: input.organizationId,
        channel: 'messenger',
        provider: 'meta_graph',
        providerAccountKey,
        externalAccountId: input.pageId,
        status: 'connected',
        credentialsEnc: input.credentialsEnc,
        lastVerifiedAt: new Date(),
        metadata: JSON.stringify({ legacyWebhook: true, source: 'Integration.facebook' }),
      },
      select: { id: true },
    })
  } catch (error) {
    const raced = await db.channelConnection.findUnique({
      where: { providerAccountKey },
      select: { id: true, organizationId: true, channel: true, provider: true, externalAccountId: true, status: true },
    })
    if (!raced || raced.organizationId !== input.organizationId || raced.channel !== 'messenger' ||
      raced.provider !== 'meta_graph' || raced.externalAccountId !== input.pageId) throw error
    if (raced.status === 'pending' || raced.status === 'connected') {
      await db.channelConnection.update({
        where: { id: raced.id },
        data: { status: 'connected', credentialsEnc: input.credentialsEnc, lastVerifiedAt: new Date(), lastErrorCode: null },
      })
    }
    return { id: raced.id }
  }
}

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
    const reclaimed = await db.channelWebhookEvent.updateMany({ where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt, claimToken: existing.claimToken }, data: { status: 'processing', claimToken, attemptCount: { increment: 1 }, lastErrorCode: null, processedAt: null, receivedAt: now } })
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


/**
 * Resolves the legacy TikTok app identity to a tenant-scoped canonical
 * connection. The app identity is hashed so neither app keys nor secrets
 * appear in providerAccountKey or logs. Ownership is always checked closed.
 */
export async function getOrCreateTikTokWebhookConnection(input: {
  organizationId: string
  appIdentity: string
  externalAccountId: string
  credentialsEnc: string
  readyForOutbound: boolean
}): Promise<{ id: string }> {
  if (!input.organizationId || typeof input.appIdentity !== 'string' || input.appIdentity.length < 1 || input.appIdentity.length > 512 || /[\u0000-\u001f\u007f]/.test(input.appIdentity) || !/^\\d{5,30}$/.test(input.externalAccountId) || !input.credentialsEnc) {
    throw new Error('Invalid TikTok app identity')
  }
  const { createHash } = await import('node:crypto')
  const identityHash = createHash('sha256').update(input.appIdentity).digest('hex')
  const providerAccountKey = `tiktok:app:${input.organizationId}:${identityHash}`
  const externalAccountId = input.externalAccountId
  const existing = await db.channelConnection.findUnique({
    where: { providerAccountKey },
    select: { id: true, organizationId: true, channel: true, provider: true, externalAccountId: true },
  })
  if (existing) {
    if (existing.organizationId !== input.organizationId || existing.channel !== 'tiktok' ||
      existing.provider !== 'tiktok_business' || existing.externalAccountId !== externalAccountId) {
      throw new Error('TikTok app connection ownership conflict')
    }
    if (existing.status === 'pending' && input.readyForOutbound) {
      await db.channelConnection.update({ where: { id: existing.id }, data: { status: 'connected', credentialsEnc: input.credentialsEnc, lastVerifiedAt: new Date(), lastErrorCode: null } })
    }
    return { id: existing.id }
  }
  try {
    return await db.channelConnection.create({
      data: {
        organizationId: input.organizationId,
        channel: 'tiktok',
        provider: 'tiktok_business',
        providerAccountKey,
        externalAccountId,
        status: input.readyForOutbound ? 'connected' : 'pending',
        credentialsEnc: input.credentialsEnc,
        lastVerifiedAt: input.readyForOutbound ? new Date() : null,
        metadata: JSON.stringify({ legacyWebhook: true, source: 'Integration.tiktok' }),
      },
      select: { id: true },
    })
  } catch (error) {
    const raced = await db.channelConnection.findUnique({
      where: { providerAccountKey },
      select: { id: true, organizationId: true, channel: true, provider: true, externalAccountId: true },
    })
    if (!raced || raced.organizationId !== input.organizationId || raced.channel !== 'tiktok' ||
      raced.provider !== 'tiktok_business' || raced.externalAccountId !== externalAccountId) throw error
    return { id: raced.id }
  }
}
