import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import {
  ChannelOutboundError,
  claimChannelOutboundMessage,
  createChannelOutboundIntent,
  markChannelOutboundSent,
  markChannelOutboundUnknown,
  quarantineStaleChannelOutboundMessages,
  reconcileUnknownChannelOutboundMessage,
  updateChannelMessageDeliveryStatus,
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

  it('vincula un echo del proveedor recibido antes de la confirmación sin duplicar el mensaje', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: 'request-echo-before-ack',
      body: 'Eco recibido antes del ACK',
    })
    await claimChannelOutboundMessage(intent.id)
    const echo = await db.channelMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: 'provider-echo-before-ack',
        direction: 'out',
        senderType: 'agent',
        body: intent.body,
        metadata: JSON.stringify({ echo: true }),
      },
    })

    const confirmed = await markChannelOutboundSent({
      id: intent.id,
      providerMessageId: 'provider-echo-before-ack',
    })
    expect(confirmed.id).toBe(echo.id)
    expect(await db.channelMessage.count({
      where: { conversationId: conversation.id, externalMessageId: 'provider-echo-before-ack' },
    })).toBe(1)
    expect((await db.channelMessage.findUnique({ where: { id: echo.id } }))?.outboundId).toBe(intent.id)
    expect((await db.channelOutboundMessage.findUnique({ where: { id: intent.id } }))?.status).toBe('sent')
  })

  it('confirma desde el webhook de estado aunque el worker haya quedado unknown y conserva el estado de entrega', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: 'request-status-callback',
      body: 'Confirmación por webhook',
    })
    await claimChannelOutboundMessage(intent.id)
    await markChannelOutboundUnknown(intent.id, 'HTTP_TIMEOUT')
    const message = await markChannelOutboundSent({
      id: intent.id,
      providerMessageId: 'wamid-status-callback',
    })
    expect((await db.channelOutboundMessage.findUnique({ where: { id: intent.id } }))?.status).toBe('sent')

    await updateChannelMessageDeliveryStatus({
      conversationId: conversation.id,
      providerMessageId: 'wamid-status-callback',
      status: 'read',
      timestamp: '1794500000',
    })
    await updateChannelMessageDeliveryStatus({
      conversationId: conversation.id,
      providerMessageId: 'wamid-status-callback',
      status: 'delivered',
    })
    const stored = await db.channelMessage.findUnique({ where: { id: message.id } })
    expect(JSON.parse(stored?.metadata || '{}')).toMatchObject({
      deliveryStatus: 'read',
      deliveryStatusAt: '1794500000',
    })
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
 
  it('dispatches through the exact provider/channel adapter and persists success', async () => {
    const conversation = await createConversation()
    const token = ['test', 'credential', 'fixture'].join('-')
    await db.channelConnection.update({
      where: { id: conversation.connectionId },
      data: { credentialsEnc: encryptSecret(JSON.stringify({ accessToken: token, appSecret: 'test-app-secret' }))! },
    })
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: 'request-dispatch01',
      body: 'Mensaje simulado',
    })
    let observed: { provider: string; channel: string; externalAccountId: string; recipientKey: string; accessToken: string } | null = null
    const result = await dispatchChannelOutboundMessage(intent.id, {
      'meta_graph:instagram': async (input) => {
        observed = { provider: input.provider, channel: input.channel, externalAccountId: input.externalAccountId, recipientKey: input.recipientKey, accessToken: input.credentials.accessToken }
        return { ok: true, providerMessageId: 'mock-provider-message' }
      },
    })
    expect(result.status).toBe('sent')
    expect(observed).toMatchObject({ provider: 'meta_graph', channel: 'instagram', externalAccountId: expect.any(String), recipientKey: conversation.externalContactKey, accessToken: token })
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('sent')
    expect(await db.channelMessage.count({ where: { outboundId: intent.id } })).toBe(1)
  })

  it('quarantines thrown provider errors and does not call the adapter again', async () => {
    const conversation = await createConversation()
    await db.channelConnection.update({
      where: { id: conversation.connectionId },
      data: { credentialsEnc: encryptSecret(JSON.stringify({ accessToken: ['test', 'credential', 'fixture'].join('-') }))! },
    })
    const intent = await createChannelOutboundIntent({ organizationId: FIX.orgA.id, conversationId: conversation.id, clientRequestId: 'request-dispatch02', body: 'Resultado ambiguo' })
    let calls = 0
    const adapters = { 'meta_graph:instagram': async () => { calls += 1; throw new Error('simulated timeout') } }
    expect((await dispatchChannelOutboundMessage(intent.id, adapters)).status).toBe('unknown')
    expect((await dispatchChannelOutboundMessage(intent.id, adapters)).status).toBe('not_claimed')
    expect(calls).toBe(1)
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('unknown')
  })

  it('fails closed when the exact provider/channel adapter is absent', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({ organizationId: FIX.orgA.id, conversationId: conversation.id, clientRequestId: 'request-dispatch03', body: 'No adapter' })
    const result = await dispatchChannelOutboundMessage(intent.id, {})
    expect(result).toMatchObject({ status: 'failed', errorCode: 'ADAPTER_UNAVAILABLE' })
  })

 
  it('reconciles unknown as sent only after explicit provider confirmation and audits it', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: 'request-reconcile01',
      body: 'Proveedor confirmó entrega',
    })
    await claimChannelOutboundMessage(intent.id)
    await markChannelOutboundUnknown(intent.id, 'PROVIDER_RESULT_UNCERTAIN')

    const message = await reconcileUnknownChannelOutboundMessage({
      id: intent.id,
      resolution: 'sent',
      providerMessageId: 'provider-confirmed-123',
    })
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    const audit = await db.channelConnectionEvent.findFirst({
      where: { connectionId: conversation.connectionId, type: 'outbound_manually_reconciled_sent' },
    })
    expect(message?.body).toBe('Proveedor confirmó entrega')
    expect(stored?.status).toBe('sent')
    expect(stored?.providerMessageId).toBe('provider-confirmed-123')
    expect(audit?.detail).toBe(`outboundId=${intent.id}`)
    await expect(reconcileUnknownChannelOutboundMessage({ id: intent.id, resolution: 'sent' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' })
  })

  it('reconciles unknown as not sent without requeueing', async () => {
    const conversation = await createConversation()
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: 'request-reconcile02',
      body: 'Proveedor confirmó rechazo',
    })
    await claimChannelOutboundMessage(intent.id)
    await markChannelOutboundUnknown(intent.id)
    await reconcileUnknownChannelOutboundMessage({ id: intent.id, resolution: 'failed' })
    const stored = await db.channelOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('failed')
    expect(stored?.providerErrorCode).toBe('MANUALLY_CONFIRMED_NOT_SENT')
    expect(await claimChannelOutboundMessage(intent.id)).toBeNull()
  })

 
  it('rejects enqueue when provider and canonical channel do not match', async () => {
    const conversation = await createConversation()
    await db.channelConnection.update({
      where: { id: conversation.connectionId },
      data: { provider: 'meta_cloud' },
    })
    await expect(createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: 'request-provider-mismatch',
      body: 'No debe encolarse',
    })).rejects.toMatchObject({ code: 'NOT_SENDABLE' })
    expect(await db.channelOutboundMessage.count({ where: { conversationId: conversation.id } })).toBe(0)
  })

})
