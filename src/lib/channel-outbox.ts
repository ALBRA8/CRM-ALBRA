import { db } from '@/lib/db'

const MAX_BODY_LENGTH = 4000
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export type ChannelOutboundStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'unknown'

export class ChannelOutboundError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_SENDABLE' | 'IDEMPOTENCY_CONFLICT' | 'INVALID_STATE'
  ) {
    super(message)
    this.name = 'ChannelOutboundError'
  }
}

/**
 * Persiste una intención antes de cualquier llamada de red.
 * La idempotencia se limita a la misma conversación y requestId.
 */
export async function createChannelOutboundIntent(input: {
  organizationId: string
  conversationId: string
  clientRequestId: string
  body: string
  requestedByUserId?: string | null
}) {
  const body = input.body.trim()
  if (!input.conversationId || !REQUEST_ID_PATTERN.test(input.clientRequestId) || !body || body.length > MAX_BODY_LENGTH) {
    throw new ChannelOutboundError('Solicitud de envío inválida', 'INVALID_INPUT')
  }

  const conversation = await db.channelConversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      channel: true,
      connection: { select: { organizationId: true, status: true, channel: true, provider: true } },
    },
  })
  if (!conversation) throw new ChannelOutboundError('Conversación no encontrada', 'NOT_FOUND')
  if (
    conversation.organizationId !== input.organizationId ||
    conversation.connection.organizationId !== input.organizationId ||
    conversation.status !== 'active' ||
    conversation.connection.status !== 'connected' ||
    conversation.channel !== conversation.connection.channel ||
    !((conversation.channel === 'whatsapp' && conversation.connection.provider === 'meta_cloud') ||
      (conversation.channel === 'instagram' && conversation.connection.provider === 'meta_graph'))
  ) {
    throw new ChannelOutboundError('La conexión no está disponible para enviar', 'NOT_SENDABLE')
  }

  try {
    return await db.channelOutboundMessage.create({
      data: {
        conversationId: conversation.id,
        clientRequestId: input.clientRequestId,
        body,
        requestedByUserId: input.requestedByUserId || null,
        status: 'queued',
      },
    })
  } catch (error) {
    const existing = await db.channelOutboundMessage.findUnique({
      where: {
        conversationId_clientRequestId: {
          conversationId: conversation.id,
          clientRequestId: input.clientRequestId,
        },
      },
    })
    if (!existing) throw error
    if (existing.body !== body) {
      throw new ChannelOutboundError('La clave de idempotencia ya se usó con otro contenido', 'IDEMPOTENCY_CONFLICT')
    }
    return existing
  }
}

/** Claim atómico: solo un worker puede mover queued → sending. */
export async function claimChannelOutboundMessage(id: string) {
  const current = await db.channelOutboundMessage.findUnique({
    where: { id },
    select: {
      conversation: {
        select: { organizationId: true, status: true, channel: true, connection: { select: { organizationId: true, status: true, channel: true } } },
      },
    },
  })
  if (
    !current ||
    current.conversation.organizationId !== current.conversation.connection.organizationId ||
    current.conversation.status !== 'active' ||
    current.conversation.connection.status !== 'connected' ||
    current.conversation.channel !== current.conversation.connection.channel
  ) return null

  const now = new Date()
  const claimed = await db.channelOutboundMessage.updateMany({
    where: {
      id,
      status: 'queued',
      conversation: {
        is: {
          status: 'active',
          connection: { is: { status: 'connected' } },
        },
      },
    },
    data: { status: 'sending', attemptCount: { increment: 1 }, startedAt: now, providerErrorCode: null },
  })
  if (claimed.count !== 1) return null
  return db.channelOutboundMessage.findUnique({ where: { id } })
}

/**
 * Resultado ambiguo (timeout/crash tras iniciar la petición): terminal unknown.
 * Nunca vuelve a queued por sí solo; un humano debe reconciliarlo con el proveedor.
 */
export async function markChannelOutboundUnknown(id: string, errorCode = 'DELIVERY_UNCERTAIN') {
  const safeCode = /^[A-Z0-9_.-]{1,64}$/.test(errorCode) ? errorCode : 'DELIVERY_UNCERTAIN'
  return db.channelOutboundMessage.updateMany({
    where: { id, status: 'sending' },
    data: { status: 'unknown', providerErrorCode: safeCode, finishedAt: new Date() },
  })
}

/** Fallo definitivo confirmado por el proveedor (p.ej. rechazo 4xx). */
export async function markChannelOutboundFailed(id: string, errorCode: string) {
  const safeCode = /^[A-Z0-9_.-]{1,64}$/.test(errorCode) ? errorCode : 'PROVIDER_REJECTED'
  return db.channelOutboundMessage.updateMany({
    where: { id, status: 'sending' },
    data: { status: 'failed', providerErrorCode: safeCode, finishedAt: new Date() },
  })
}

/**
 * Confirmación tras respuesta 2xx del proveedor. Mensaje + estado outbox + preview
 * se escriben en una transacción. No realiza llamadas de red.
 */
export async function markChannelOutboundSent(input: {
  id: string
  providerMessageId?: string | null
}) {
  return db.$transaction(async (tx) => {
    const outbound = await tx.channelOutboundMessage.findUnique({
      where: { id: input.id },
      include: { conversation: true },
    })
    if (!outbound) throw new ChannelOutboundError('Intención no encontrada', 'NOT_FOUND')

    const existingMessage = await tx.channelMessage.findUnique({ where: { outboundId: outbound.id } })
    if (outbound.status === 'sent' && existingMessage) return existingMessage
    if (outbound.status !== 'sending') {
      throw new ChannelOutboundError('La intención no está en estado sending', 'INVALID_STATE')
    }

    const now = new Date()
    const message = await tx.channelMessage.create({
      data: {
        conversationId: outbound.conversationId,
        outboundId: outbound.id,
        externalMessageId: input.providerMessageId || null,
        direction: 'out',
        senderType: 'user',
        body: outbound.body,
      },
    })
    await tx.channelOutboundMessage.update({
      where: { id: outbound.id },
      data: {
        status: 'sent',
        providerMessageId: input.providerMessageId || null,
        providerErrorCode: null,
        sentAt: now,
        finishedAt: now,
      },
    })
    await tx.channelConversation.update({
      where: { id: outbound.conversationId },
      data: {
        lastMessage: outbound.body.slice(0, 500),
        lastMessageAt: now,
      },
    })
    return message
  })
}

/**
 * Recuperación conservadora: procesos muertos en sending pasan a unknown.
 * La función deliberadamente NO reintenta ni vuelve a ponerlos en cola.
 */
export async function quarantineStaleChannelOutboundMessages(olderThan: Date) {
  return db.channelOutboundMessage.updateMany({
    where: { status: 'sending', startedAt: { lt: olderThan } },
    data: { status: 'unknown', providerErrorCode: 'WORKER_INTERRUPTED', finishedAt: new Date() },
  })
}

/**
 * Resolución manual de unknown después de comprobar el estado en el proveedor.
 * Nunca vuelve a poner la intención en queued ni realiza llamadas de red.
 */
export async function reconcileUnknownChannelOutboundMessage(input: {
  id: string
  resolution: 'sent' | 'failed'
  providerMessageId?: string | null
}) {
  return db.$transaction(async (tx) => {
    const outbound = await tx.channelOutboundMessage.findUnique({
      where: { id: input.id },
      include: { conversation: { select: { id: true, organizationId: true, connectionId: true } } },
    })
    if (!outbound) throw new ChannelOutboundError('Intención no encontrada', 'NOT_FOUND')
    if (outbound.status !== 'unknown') {
      throw new ChannelOutboundError('Solo se pueden conciliar intenciones unknown', 'INVALID_STATE')
    }

    const now = new Date()
    if (input.resolution === 'sent') {
      const message = await tx.channelMessage.create({
        data: {
          conversationId: outbound.conversationId,
          outboundId: outbound.id,
          externalMessageId: input.providerMessageId || null,
          direction: 'out',
          senderType: 'user',
          body: outbound.body,
        },
      })
      await tx.channelOutboundMessage.update({
        where: { id: outbound.id },
        data: {
          status: 'sent',
          providerMessageId: input.providerMessageId || null,
          providerErrorCode: 'MANUALLY_CONFIRMED_SENT',
          sentAt: now,
          finishedAt: now,
        },
      })
      await tx.channelConversation.update({
        where: { id: outbound.conversationId },
        data: { lastMessage: outbound.body.slice(0, 500), lastMessageAt: now },
      })
      await tx.channelConnectionEvent.create({
        data: {
          organizationId: outbound.conversation.organizationId,
          connectionId: outbound.conversation.connectionId,
          type: 'outbound_manually_reconciled_sent',
          detail: `outboundId=${outbound.id}`,
        },
      })
      return message
    }

    await tx.channelOutboundMessage.update({
      where: { id: outbound.id },
      data: {
        status: 'failed',
        providerErrorCode: 'MANUALLY_CONFIRMED_NOT_SENT',
        finishedAt: now,
      },
    })
    await tx.channelConnectionEvent.create({
      data: {
        organizationId: outbound.conversation.organizationId,
        connectionId: outbound.conversation.connectionId,
        type: 'outbound_manually_reconciled_failed',
        detail: `outboundId=${outbound.id}`,
      },
    })
    return null
  })
}
