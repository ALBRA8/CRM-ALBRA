import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import {
  ChannelOutboundError,
  claimChannelOutboundMessage,
  createChannelOutboundIntent,
  markChannelOutboundSent,
  markChannelOutboundUnknown,
  quarantineStaleChannelOutboundMessages,
} from '@/lib/channel-outbox'
import { FIX } from '../setup/seed-data'
import { encryptSecret } from '@/lib/crypto'
import { dispatchChannelOutboundMessage } from '@/lib/channel-outbound-dispatcher'

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const connectionIds: string[] = []
const conversationIds: string[] = []

afterEach(async () => {
  if (conversationIds.length) {
    await db.channelOutboundMessage.deleteMany({ where: { conversationId: { in: conversationIds } } })
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

async function createConversation(orgId: string = FIX.orgA.id) {
  const id = `outbox-connection-${suffix()}`
  const connection = await db.channelConnection.create({
    data: {
      id,
      organizationId: orgId,
      channel: 'instagram',
      provider: 'meta_graph',
      providerAccountKey: `meta:instagram:outbox:${id}`,
      externalAccountId: id,
      displayName: 'Cuenta Outbox',
      credentialsEnc: 'v1:test-ciphertext',
      status: 'connected',
    },
  })
  connectionIds.push(connection.id)
  const conversation = await db.channelConversation.create({
    data: {
      id: `outbox-conversation-${suffix()}`,
      organizationId: orgId,
      connectionId: connection.id,
      channel: 'instagram',
      externalContactKey: `contact-${suffix()}`,
    },
  })
  conversationIds.push(conversation.id)
  return conversation
}

describe('Channel outbound outbox — idempotencia y recuperación conservadora', () => {
  it('deduplica solicitudes por conversación y rechaza reutilizar la clave con otro cuerpo', async () => {
    const conversation = await createConversation()
    const input = {
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: `request-abcdefgh`,
      body: '  Hola  ',
    }
    const first = await createChannelOutboundIntent(input)
    const retry = await createChannelOutboundIntent(input)
    expect(retry.id).toBe(first.id)
    expect(retry.status).toBe('queued')

    await expect(createChannelOutboundIntent({ ...input, body: 'Otro mensaje' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(await db.channelOutboundMessage.count({ where: { conversationId: conversation.id } })).toBe(1)
  })

  it('reclama una sola vez y confirma mensaje + preview en la misma transacción', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: `request-ijklmnop`,
      body: 'Respuesta confirmada',
    })

    const [first, second] = await Promise.all([
      claimChannelOutboundMessage(intent.id),
      claimChannelOutboundMessage(intent.id),
    ])
    expect([first, second].filter(Boolean)).toHaveLength(1)

    const sent = await markChannelOutboundSent({ id: intent.id, providerMessageId: 'provider-msg-123' })
    expect(sent.body).toBe('Respuesta confirmada')
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    const updatedConversation = await db.channelConversation.findUnique({ where: { id: conversation.id } })
    expect(stored?.status).toBe('sent')
    expect(updatedConversation?.lastMessage).toBe('Respuesta confirmada')
    expect(await db.channelMessage.count({ where: { outboundId: intent.id } })).toBe(1)
    expect((await markChannelOutboundSent({ id: intent.id })).id).toBe(sent.id)
  })

  it('pone un resultado incierto en cuarentena y nunca lo reencola', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: `request-qrstuvwx`,
      body: 'No reenviar a ciegas',
    })
    expect(await claimChannelOutboundMessage(intent.id)).not.toBeNull()
    await markChannelOutboundUnknown(intent.id, 'NETWORK_TIMEOUT')
    expect(await claimChannelOutboundMessage(intent.id)).toBeNull()
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('unknown')
    expect(stored?.providerErrorCode).toBe('NETWORK_TIMEOUT')
  })

  it('no reclama una intención si la conexión se desconectó después de encolarla', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: `request-${'disconn1'}`,
      body: 'No enviar por una cuenta desconectada',
    })
    await db.channelConnection.update({
      where: { id: conversation.connectionId },
      data: { status: 'disconnected' },
    })
    expect(await claimChannelOutboundMessage(intent.id)).toBeNull()
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('queued')
    expect(stored?.attemptCount).toBe(0)
  })

  it('no crea intenciones para conversaciones de otro tenant', async () => {
    const foreign = await createConversation(FIX.orgB.id)
    await expect(createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: foreign.id,
      clientRequestId: `request-yzabcdef`,
      body: 'No debe salir',
    })).rejects.toBeInstanceOf(ChannelOutboundError)
    expect(await db.channelOutboundMessage.count({ where: { conversationId: foreign.id } })).toBe(0)
  })

  it('cuarentena los workers abandonados sin reintentarlos', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: `request-stale000`,
      body: 'Worker interrumpido',
    })
    await claimChannelOutboundMessage(intent.id)
    await db.channelOutboundMessage.update({ where: { id: intent.id }, data: { startedAt: new Date(Date.now() - 60_000) } })
    const result = await quarantineStaleChannelOutboundMessages(new Date(Date.now() - 30_000))
    expect(result.count).toBe(1)
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('unknown')
    expect(await claimChannelOutboundMessage(intent.id)).toBeNull()
  })
})
