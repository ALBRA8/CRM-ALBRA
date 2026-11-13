import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { FIX } from '../setup/seed-data'

const connectionIds: string[] = []
const conversationIds: string[] = []
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

afterEach(async () => {
  if (conversationIds.length) {
    await db.channelMessage.deleteMany({ where: { conversationId: { in: conversationIds } } })
    await db.channelConversation.deleteMany({ where: { id: { in: conversationIds } } })
    conversationIds.length = 0
  }
  if (connectionIds.length) {
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
    await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
    connectionIds.length = 0
  }
})

describe('ChannelMessage — aislamiento e idempotencia por conversación', () => {
  it('permite el mismo ID externo en dos conexiones, pero deduplica dentro de cada una', async () => {
    const suffixValue = suffix()
    const connections = await Promise.all(['one', 'two'].map((label) => db.channelConnection.create({
      data: {
        id: `message-connection-${label}-${suffixValue}`,
        organizationId: FIX.orgA.id,
        channel: 'whatsapp',
        provider: 'meta_cloud',
        providerAccountKey: `meta:whatsapp:message:${suffixValue}:${label}`,
        externalAccountId: `phone-${suffixValue}-${label}`,
        credentialsEnc: 'v1:test-ciphertext',
        status: 'connected',
      },
    })))
    connectionIds.push(...connections.map((connection) => connection.id))

    const conversations = await Promise.all(connections.map((connection, index) => db.channelConversation.create({
      data: {
        id: `message-conversation-${index}-${suffixValue}`,
        organizationId: FIX.orgA.id,
        connectionId: connection.id,
        channel: 'whatsapp',
        externalContactKey: '+573001112233',
      },
    })))
    conversationIds.push(...conversations.map((conversation) => conversation.id))

    const messageId = `wamid.${suffixValue}`
    for (const [index, conversation] of conversations.entries()) {
      await db.channelMessage.create({
        data: {
          organizationId: FIX.orgA.id,
          connectionId: connections[index].id,
          conversationId: conversation.id,
          externalMessageId: messageId,
          direction: 'in',
          senderType: 'contact',
          body: `Mensaje de cuenta ${index}`,
        },
      })
    }

    await expect(db.channelMessage.create({
      data: {
        organizationId: FIX.orgA.id,
        connectionId: connections[0].id,
        conversationId: conversations[0].id,
        externalMessageId: messageId,
        direction: 'in',
        senderType: 'contact',
        body: 'Duplicado',
      },
    })).rejects.toMatchObject({ code: 'P2002' })

    const stored = await db.channelMessage.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { conversationId: 'asc' },
    })
    expect(stored).toHaveLength(2)
    expect(new Set(stored.map((message) => message.conversationId)).size).toBe(2)
    expect(stored.map((message) => message.body).sort()).toEqual(['Mensaje de cuenta 0', 'Mensaje de cuenta 1'])
  })
})
