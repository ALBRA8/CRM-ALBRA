import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/instagram/webhook/route'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { FIX } from '../setup/seed-data'

const APP_SECRET = 'test'.repeat(10)
const connectionIds: string[] = []
let legacyOrganizationId: string | null = null

afterEach(async () => {
  if (connectionIds.length) {
    await db.channelWebhookEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelMessage.deleteMany({ where: { conversation: { is: { connectionId: { in: connectionIds } } } } })
    await db.channelConversation.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
    connectionIds.length = 0
  }
  if (legacyOrganizationId) {
    await db.integration.deleteMany({ where: { organizationId: legacyOrganizationId } })
    await db.organization.deleteMany({ where: { id: legacyOrganizationId } })
    legacyOrganizationId = null
  }
})

async function createInstagramConnection(accountId: string, status: 'connected' | 'disconnected' = 'connected') {
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
      status,
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


describe('GET /api/instagram/webhook — subscription verification', () => {
  it('rejects a non-subscribe mode before checking configured tokens', async () => {
    const response = await GET(new NextRequest(
      'http://localhost:3000/api/instagram/webhook?hub.mode=unsubscribe&hub.verify_token=fixture&hub.challenge=123'
    ))
    expect(response.status).toBe(403)
  })
})

describe('POST /api/instagram/webhook — multi-account batch and durable echo ledger', () => {
  it('does not fall back to legacy Integration when the same canonical account is disconnected', async () => {
    const accountId = '17840000000000999'
    await createInstagramConnection(accountId, 'disconnected')
    const legacyOrg = await db.organization.create({
      data: {
        id: `instagram-legacy-org-${Date.now()}`,
        name: 'Instagram legacy fallback test',
        slug: `instagram-legacy-${Date.now()}`,
      },
    })
    legacyOrganizationId = legacyOrg.id
    await db.integration.create({
      data: {
        organizationId: legacyOrg.id,
        instagramAccountId: accountId,
        instagramTokenEnc: encryptSecret(JSON.stringify({ token: 'legacy-token-fixture', webhookSecret: APP_SECRET })),
      },
    })
    const payload = {
      object: 'instagram',
      entry: [{
        id: accountId,
        messaging: [{
          sender: { id: accountId },
          recipient: { id: 'contact-legacy-fallback' },
          message: { mid: 'ig.mid.disconnected', text: 'No procesar por legacy', is_echo: true },
        }],
      }],
    }
    const response = await POST(signedRequest(JSON.stringify(payload)))
    expect(response.status).toBe(401)
    expect(await db.channelWebhookEvent.count({ where: { connectionId: { in: connectionIds } } })).toBe(0)
  })

  it('persists echoes for each exact account in one signed batch and deduplicates replay', async () => {
    const accountA = '17840000000000001'
    const accountB = '17840000000000002'
    const connectionA = await createInstagramConnection(accountA)
    const connectionB = await createInstagramConnection(accountB)
    await createInstagramConnection('17840000000000003', 'disconnected')
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
        {
          id: '17840000000000003',
          messaging: [{
            sender: { id: '17840000000000003' },
            recipient: { id: 'contact-10003' },
            message: { mid: 'ig.mid.batch-disconnected', text: 'Echo C', is_echo: true },
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
  it('does not auto-reply to inbound messages unless the explicit flag is enabled', async () => {
    const previous = process.env.CHANNEL_AUTOREPLY_ENABLED
    delete process.env.CHANNEL_AUTOREPLY_ENABLED
    const accountId = '17840000000000991'
    const connection = await createInstagramConnection(accountId)
    const payload = {
      object: 'instagram',
      entry: [{
        id: accountId,
        messaging: [{
          sender: { id: 'contact-no-auto-reply' },
          recipient: { id: accountId },
          message: { mid: 'ig.mid.no-auto-reply', text: 'Mensaje entrante de prueba' },
        }],
      }],
    }
    try {
      const response = await POST(signedRequest(JSON.stringify(payload)))
      expect(response.status).toBe(200)
      const outbound = await db.channelMessage.findMany({
        where: { conversation: { connectionId: connection.id }, direction: 'out' },
      })
      expect(outbound).toHaveLength(0)
      const autoReply = await db.timelineEvent.findFirst({
        where: { organizationId: FIX.orgA.id, title: 'Respuesta automática del agente IA' },
      })
      expect(autoReply).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.CHANNEL_AUTOREPLY_ENABLED
      else process.env.CHANNEL_AUTOREPLY_ENABLED = previous
    }
  })

})
