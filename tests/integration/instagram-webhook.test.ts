import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/instagram/webhook/route'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { FIX } from '../setup/seed-data'

const APP_SECRET = 'test'.repeat(10)
const connectionIds: string[] = []

afterEach(async () => {
  if (connectionIds.length) {
    await db.channelWebhookEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelMessage.deleteMany({ where: { conversation: { connectionId: { in: connectionIds } } } })
    await db.channelConversation.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
    connectionIds.length = 0
  }
})

async function createInstagramConnection(accountId: string) {
  const id = `instagram-webhook-${accountId}`
  const connection = await db.channelConnection.create({
    data: {
      id,
      organizationId: FIX.orgA.id,
      channel: 'instagram',
      provider: 'meta_graph',
      providerAccountKey: `meta:instagram:${accountId}`,
      externalAccountId: accountId,
      displayName: `Cuenta ${accountId}`,
      credentialsEnc: encryptSecret(JSON.stringify({
        accessToken: `token-fixture-${accountId}`,
        appSecret: APP_SECRET,
      }))!,
      status: 'connected',
    },
  })
  connectionIds.push(connection.id)
  return connection
}

function signedRequest(raw: string) {
  const signature = 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex')
  return new NextRequest('http://localhost:3000/api/instagram/webhook', {
    method: 'POST',
    body: raw,
    headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': signature }),
  })
}

describe('POST /api/instagram/webhook — multi-account batch and durable echo ledger', () => {
  it('persists echoes for each exact account in one signed batch and deduplicates replay', async () => {
    const accountA = '17840000000000001'
    const accountB = '17840000000000002'
    const connectionA = await createInstagramConnection(accountA)
    const connectionB = await createInstagramConnection(accountB)
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: accountA,
          messaging: [{
            sender: { id: accountA },
            recipient: { id: 'contact-10001' },
            message: { mid: 'ig.mid.batch-a', text: 'Echo A', is_echo: true },
          }],
        },
        {
          id: accountB,
          messaging: [{
            sender: { id: accountB },
            recipient: { id: 'contact-10002' },
            message: { mid: 'ig.mid.batch-b', text: 'Echo B', is_echo: true },
          }],
        },
      ],
    }
    const raw = JSON.stringify(payload)
    const response = await POST(signedRequest(raw))
    expect(response.status).toBe(200)

    const conversations = await db.channelConversation.findMany({
      where: { connectionId: { in: [connectionA.id, connectionB.id] } },
      orderBy: { connectionId: 'asc' },
    })
    expect(conversations).toHaveLength(2)
    expect(new Set(conversations.map((conversation) => conversation.connectionId)).size).toBe(2)
    const messages = await db.channelMessage.findMany({
      where: { conversationId: { in: conversations.map((conversation) => conversation.id) } },
      orderBy: { externalMessageId: 'asc' },
    })
    expect(messages).toHaveLength(2)
    expect(messages.map((message) => message.body).sort()).toEqual(['Echo A', 'Echo B'])
    expect(messages.every((message) => message.direction === 'out')).toBe(true)
    expect(await db.channelWebhookEvent.count({
      where: { connectionId: { in: [connectionA.id, connectionB.id] }, status: 'processed' },
    })).toBe(2)

    const replay = await POST(signedRequest(raw))
    expect(replay.status).toBe(200)
    expect(await db.channelMessage.count({
      where: { conversationId: { in: conversations.map((conversation) => conversation.id) } },
    })).toBe(2)
    expect(await db.channelWebhookEvent.count({
      where: { connectionId: { in: [connectionA.id, connectionB.id] } },
    })).toBe(2)
  })
})
