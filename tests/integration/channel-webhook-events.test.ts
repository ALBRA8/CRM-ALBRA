import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { claimChannelWebhookEvent, completeChannelWebhookEvent, failChannelWebhookEvent } from '@/lib/channel-webhook-events'
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

async function createConnection() {
  const id = `webhook-event-connection-${suffix()}`
  const connection = await db.channelConnection.create({
    data: {
      id,
      organizationId: FIX.orgA.id,
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
    expect((await completeChannelWebhookEvent(claim.id)).count).toBe(1)
    expect(await claimChannelWebhookEvent(input)).toBeNull()
    const stored = await db.channelWebhookEvent.findUnique({ where: { id: claim.id } })
    expect(stored?.status).toBe('processed')
    expect(stored?.attemptCount).toBe(1)
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
    await failChannelWebhookEvent(first!.id, 'TEMPORARY_PROVIDER_ERROR')
    const retry = await claimChannelWebhookEvent(input)
    expect(retry?.id).toBe(first?.id)
    const stored = await db.channelWebhookEvent.findUnique({ where: { id: first!.id } })
    expect(stored).toMatchObject({ status: 'processing', attemptCount: 2, lastErrorCode: null })
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
