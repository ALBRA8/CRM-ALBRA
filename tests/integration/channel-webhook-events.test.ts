import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { claimChannelWebhookEvent, completeChannelWebhookEvent, failChannelWebhookEvent, getChannelWebhookEventStatus, getOrCreateTelegramWebhookConnection, getOrCreateMessengerWebhookConnection } from '@/lib/channel-webhook-events'
import { FIX } from '../setup/seed-data'

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const connectionIds: string[] = []

afterEach(async () => {
  if (connectionIds.length) {
    await db.channelWebhookEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
    connectionIds.length = 0
  }
})

async function createConnection(organizationId: string = FIX.orgA.id) {
  const id = `webhook-event-connection-${suffix()}`
  const connection = await db.channelConnection.create({
    data: {
      id,
      organizationId,
      channel: 'whatsapp',
      provider: 'meta_cloud',
      providerAccountKey: `meta:whatsapp:webhook-event:${id}`,
      externalAccountId: id,
      credentialsEnc: 'v1:test-ciphertext',
      status: 'connected',
    },
  })
  connectionIds.push(id)
  return connection
}

describe('Telegram webhook event identity', () => {
  it('reuses the canonical bot connection and claims one update only once', async () => {
    const botId = `900000${String(Date.now()).slice(-8)}`
    const [a, b] = await Promise.all([
      getOrCreateTelegramWebhookConnection({ organizationId: FIX.orgA.id, botId, credentialsEnc: 'v1:synthetic-encrypted-credentials' }),
      getOrCreateTelegramWebhookConnection({ organizationId: FIX.orgA.id, botId, credentialsEnc: 'v1:synthetic-encrypted-credentials' }),
    ])
    connectionIds.push(a.id)
    expect(a.id).toBe(b.id)

    const input = {
      organizationId: FIX.orgA.id,
      connectionId: a.id,
      eventKey: 'update:987654321',
      eventType: 'telegram.update',
    }
    const claims = await Promise.all([
      claimChannelWebhookEvent(input),
      claimChannelWebhookEvent(input),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find(Boolean)!
    expect((await completeChannelWebhookEvent(claim)).count).toBe(1)
    expect(await claimChannelWebhookEvent(input)).toBeNull()
    expect(await getChannelWebhookEventStatus(a.id, input.eventKey)).toBe('processed')
  })

  it('fails closed when a Telegram bot identity is already owned by another tenant', async () => {
    const botId = `910000${String(Date.now()).slice(-8)}`
    const connection = await getOrCreateTelegramWebhookConnection({
      organizationId: FIX.orgA.id,
      botId,
      credentialsEnc: 'v1:synthetic-encrypted-credentials',
    })
    connectionIds.push(connection.id)
    await expect(getOrCreateTelegramWebhookConnection({
      organizationId: FIX.orgB.id,
      botId,
      credentialsEnc: 'v1:other-tenant-credentials',
    })).rejects.toThrow('Telegram bot connection ownership conflict')
  })
})


describe('Messenger webhook connection identity', () => {
  it('reuses the canonical Page connection and rejects cross-tenant ownership', async () => {
    const pageId = `100000${String(Date.now()).slice(-8)}`
    const [a, b] = await Promise.all([
      getOrCreateMessengerWebhookConnection({ organizationId: FIX.orgA.id, pageId, credentialsEnc: 'v1:synthetic-encrypted-page-credentials' }),
      getOrCreateMessengerWebhookConnection({ organizationId: FIX.orgA.id, pageId, credentialsEnc: 'v1:synthetic-encrypted-page-credentials' }),
    ])
    connectionIds.push(a.id)
    expect(a.id).toBe(b.id)
    const storedConnection = await db.channelConnection.findUnique({ where: { id: a.id } })
    expect(storedConnection?.status).toBe('connected')
    expect(storedConnection?.lastVerifiedAt).toBeInstanceOf(Date)
    await expect(getOrCreateMessengerWebhookConnection({
      organizationId: FIX.orgB.id,
      pageId,
      credentialsEnc: 'v1:other-tenant-page-credentials',
    })).rejects.toThrow('Messenger Page connection ownership conflict')

    const event = {
      organizationId: FIX.orgA.id,
      connectionId: a.id,
      eventKey: 'message:mid_messenger_durable_123',
      eventType: 'messenger.message',
    }
    const claims = await Promise.all([
      claimChannelWebhookEvent(event),
      claimChannelWebhookEvent(event),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find(Boolean)!
    expect((await completeChannelWebhookEvent(claim)).count).toBe(1)
    expect(await claimChannelWebhookEvent(event)).toBeNull()
    expect(await getChannelWebhookEventStatus(a.id, event.eventKey)).toBe('processed')
  })

  it('rejects malformed Page identities before creating a connection', async () => {
    await expect(getOrCreateMessengerWebhookConnection({
      organizationId: FIX.orgA.id,
      pageId: 'page id with spaces',
      credentialsEnc: 'v1:synthetic-encrypted-page-credentials',
    })).rejects.toThrow('Invalid Messenger Page identity')
  })
})

describe('Channel webhook event ledger', () => {
  it('allows only one concurrent claimant and never reclaims a processed event', async () => {
    const connection = await createConnection()
    const input = {
      organizationId: FIX.orgA.id,
      connectionId: connection.id,
      eventKey: 'message:wamid_concurrent_123',
      eventType: 'whatsapp.message',
    }
    const claims = await Promise.all([
      claimChannelWebhookEvent(input),
      claimChannelWebhookEvent(input),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find(Boolean)!
    expect((await completeChannelWebhookEvent(claim)).count).toBe(1)
    expect(await claimChannelWebhookEvent(input)).toBeNull()
    const stored = await db.channelWebhookEvent.findUnique({ where: { id: claim.id } })
    expect(stored?.status).toBe('processed')
    expect(stored?.attemptCount).toBe(1)
  })

  it('distinguishes an event currently processing from a completed duplicate', async () => {
    const connection = await createConnection()
    const input = {
      organizationId: FIX.orgA.id,
      connectionId: connection.id,
      eventKey: 'message:wamid_busy_123',
      eventType: 'whatsapp.message',
    }
    const first = await claimChannelWebhookEvent(input)
    expect(first).not.toBeNull()
    expect(await claimChannelWebhookEvent(input)).toBeNull()
    expect(await getChannelWebhookEventStatus(connection.id, input.eventKey)).toBe('processing')
    await completeChannelWebhookEvent(first!)
    expect(await getChannelWebhookEventStatus(connection.id, input.eventKey)).toBe('processed')
  })

  it('isolates identical event keys across organizations and connections', async () => {
    const a = await createConnection(FIX.orgA.id)
    const b = await createConnection(FIX.orgB.id)
    const eventKey = 'message:wamid_same_id_two_tenants'
    const [claimA, claimB] = await Promise.all([
      claimChannelWebhookEvent({ organizationId: FIX.orgA.id, connectionId: a.id, eventKey, eventType: 'whatsapp.message' }),
      claimChannelWebhookEvent({ organizationId: FIX.orgB.id, connectionId: b.id, eventKey, eventType: 'whatsapp.message' }),
    ])
    expect(claimA).not.toBeNull()
    expect(claimB).not.toBeNull()
    expect(claimA?.id).not.toBe(claimB?.id)
    expect(await db.channelWebhookEvent.count({ where: { connectionId: { in: [a.id, b.id] }, eventKey } })).toBe(2)
  })

  it('rejects a tenant that does not own the connection', async () => {
    const connection = await createConnection()
    await expect(claimChannelWebhookEvent({
      organizationId: FIX.orgB.id,
      connectionId: connection.id,
      eventKey: 'message:wamid_wrong_tenant',
      eventType: 'whatsapp.message',
    })).rejects.toThrow('Channel webhook event connection not found')
    expect(await db.channelWebhookEvent.count({ where: { connectionId: connection.id } })).toBe(0)
  })

  it('reclaims failed events with an incremented attempt count', async () => {
    const connection = await createConnection()
    const input = {
      organizationId: FIX.orgA.id,
      connectionId: connection.id,
      eventKey: 'status:wamid_failed_123:delivered',
      eventType: 'whatsapp.status',
    }
    const first = await claimChannelWebhookEvent(input)
    expect(first).not.toBeNull()
    await failChannelWebhookEvent(first!, 'TEMPORARY_PROVIDER_ERROR')
    const retry = await claimChannelWebhookEvent(input)
    expect(retry?.id).toBe(first?.id)
    const stored = await db.channelWebhookEvent.findUnique({ where: { id: first!.id } })
    expect(stored).toMatchObject({ status: 'processing', attemptCount: 2, lastErrorCode: null })
  })

  it('reclaims a processing lease abandoned by a crashed handler', async () => {
    const connection = await createConnection()
    const input = {
      organizationId: FIX.orgA.id,
      connectionId: connection.id,
      eventKey: 'message:wamid_stale_123',
      eventType: 'whatsapp.message',
    }
    const first = await claimChannelWebhookEvent(input)
    await db.channelWebhookEvent.update({
      where: { id: first!.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    })
    const retry = await claimChannelWebhookEvent(input)
    expect(retry?.id).toBe(first?.id)
    expect((await db.channelWebhookEvent.findUnique({ where: { id: first!.id } }))?.attemptCount).toBe(2)
  })

  it('fences an expired owner after a new claim takes over the lease', async () => {
    const connection = await createConnection()
    const input = { organizationId: FIX.orgA.id, connectionId: connection.id, eventKey: 'message:wamid_fenced_123', eventType: 'whatsapp.message' }
    const oldClaim = await claimChannelWebhookEvent(input)
    await db.channelWebhookEvent.update({ where: { id: oldClaim!.id }, data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } })
    const newClaim = await claimChannelWebhookEvent(input)
    expect(newClaim?.claimToken).not.toBe(oldClaim?.claimToken)
    expect((await completeChannelWebhookEvent(oldClaim!)).count).toBe(0)
    expect((await failChannelWebhookEvent(oldClaim!, 'STALE_OWNER')).count).toBe(0)
    expect((await db.channelWebhookEvent.findUnique({ where: { id: oldClaim!.id } }))?.status).toBe('processing')
    expect((await completeChannelWebhookEvent(newClaim!)).count).toBe(1)
  })

  it('allows only one concurrent reclaimer of an expired lease', async () => {
    const connection = await createConnection()
    const input = { organizationId: FIX.orgA.id, connectionId: connection.id, eventKey: 'message:wamid_concurrent_reclaim', eventType: 'whatsapp.message' }
    const original = await claimChannelWebhookEvent(input)
    await db.channelWebhookEvent.update({ where: { id: original!.id }, data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } })
    const reclaimers = await Promise.all([claimChannelWebhookEvent(input), claimChannelWebhookEvent(input)])
    expect(reclaimers.filter(Boolean)).toHaveLength(1)
    expect(reclaimers.filter(Boolean)[0]?.claimToken).not.toBe(original?.claimToken)
    expect((await completeChannelWebhookEvent(original!)).count).toBe(0)
  })

  it('rejects malformed event keys and never stores raw payloads', async () => {
    const connection = await createConnection()
    await expect(claimChannelWebhookEvent({
      organizationId: FIX.orgA.id,
      connectionId: connection.id,
      eventKey: 'raw payload with spaces',
      eventType: 'whatsapp.message',
    })).rejects.toThrow('Invalid channel webhook event identity')
    expect(await db.channelWebhookEvent.count({ where: { connectionId: connection.id } })).toBe(0)
  })
})
