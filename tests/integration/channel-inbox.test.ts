import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { getInboxMessages, listInbox, markInboxRead, parseInboxKey } from '@/lib/inbox'
import { FIX } from '../setup/seed-data'

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const connectionIds: string[] = []
const conversationIds: string[] = []

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

async function createConversation(orgId: string, label: string, externalContactKey: string) {
  const id = `inbox-connection-${label}-${suffix()}`
  const connection = await db.channelConnection.create({
    data: {
      id,
      organizationId: orgId,
      channel: 'instagram',
      provider: 'meta_graph',
      providerAccountKey: `meta:instagram:inbox:${id}`,
      externalAccountId: id,
      displayName: `Cuenta ${label}`,
      credentialsEnc: 'v1:test-ciphertext',
      status: 'connected',
    },
  })
  connectionIds.push(connection.id)
  const conversation = await db.channelConversation.create({
    data: {
      id: `inbox-conversation-${label}-${suffix()}`,
      organizationId: orgId,
      connectionId: connection.id,
      channel: 'instagram',
      externalContactKey,
      contactName: 'Mismo contacto',
      lastMessage: 'Mensaje de prueba',
      lastMessageAt: new Date(),
      unreadCount: 2,
    },
  })
  conversationIds.push(conversation.id)
  await db.channelMessage.create({
    data: {
      conversationId: conversation.id,
      externalMessageId: `mid-${conversation.id}`,
      direction: 'in',
      senderType: 'contact',
      body: 'Hola desde la cuenta exacta',
    },
  })
  return { connection, conversation }
}

describe('Inbox canónico — tenant y conexión exacta', () => {
  it('usa keys cc estables y no mezcla cuentas del mismo contacto', async () => {
    const first = await createConversation(FIX.orgA.id, 'A', 'same-sender')
    const second = await createConversation(FIX.orgA.id, 'B', 'same-sender')

    const listed = await listInbox(FIX.orgA.id, 200)
    const own = listed.filter((item) => item.key === `cc:${first.conversation.id}` || item.key === `cc:${second.conversation.id}`)

    expect(own).toHaveLength(2)
    expect(new Set(own.map((item) => item.key)).size).toBe(2)
    expect(own.map((item) => item.connectionName).sort()).toEqual(['Cuenta A', 'Cuenta B'])
  })

  it('no lista ni permite leer o marcar como leída una conversación de otro tenant', async () => {
    const foreign = await createConversation(FIX.orgB.id, 'FOREIGN', 'private-sender')
    const listed = await listInbox(FIX.orgA.id, 200)
    expect(listed.some((item) => item.key === `cc:${foreign.conversation.id}`)).toBe(false)
    expect(await getInboxMessages(FIX.orgA.id, `cc:${foreign.conversation.id}`)).toEqual([])

    await markInboxRead(FIX.orgA.id, `cc:${foreign.conversation.id}`)
    const unchanged = await db.channelConversation.findUnique({ where: { id: foreign.conversation.id } })
    expect(unchanged?.unreadCount).toBe(2)
  })

  it('lee mensajes canónicos en orden y marca solo la conversación propia', async () => {
    const own = await createConversation(FIX.orgA.id, 'OWN', 'sender-own')
    const messages = await getInboxMessages(FIX.orgA.id, `cc:${own.conversation.id}`)
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('Hola desde la cuenta exacta')
    expect(parseInboxKey(`cc:${own.conversation.id}`)).toEqual({ channel: null, id: own.conversation.id })

    await markInboxRead(FIX.orgA.id, `cc:${own.conversation.id}`)
    const updated = await db.channelConversation.findUnique({ where: { id: own.conversation.id } })
    expect(updated?.unreadCount).toBe(0)
  })
})
