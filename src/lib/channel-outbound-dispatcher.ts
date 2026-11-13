import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import {
  claimChannelOutboundMessage,
  markChannelOutboundFailed,
  markChannelOutboundSent,
  markChannelOutboundUnknown,
} from '@/lib/channel-outbox'

export interface ChannelProviderCredentials {
  accessToken: string
  appSecret?: string | null
}

export interface ChannelProviderSendInput {
  channel: string
  provider: string
  externalAccountId: string
  recipientKey: string
  body: string
  credentials: ChannelProviderCredentials
}

export type ChannelProviderSendResult =
  | { ok: true; providerMessageId?: string | null }
  | { ok: false; definitive: true; errorCode: string }
  | { ok: false; definitive: false; errorCode?: string }

export type ChannelProviderAdapter = (
  input: ChannelProviderSendInput
) => Promise<ChannelProviderSendResult>

export type ChannelProviderAdapters = Readonly<Record<string, ChannelProviderAdapter>>

export type DispatchResult =
  | { status: 'not_claimed' }
  | { status: 'sent'; messageId: string }
  | { status: 'failed'; errorCode: string }
  | { status: 'unknown'; errorCode: string }

function adapterKey(provider: string, channel: string): string {
  return `${provider}:${channel}`
}

function readCredentials(payload: string): ChannelProviderCredentials | null {
  const plain = decryptSecret(payload)
  if (!plain) return null
  try {
    const parsed = JSON.parse(plain) as Record<string, unknown>
    if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) return null
    return {
      accessToken: parsed.accessToken,
      appSecret: typeof parsed.appSecret === 'string' ? parsed.appSecret : null,
    }
  } catch {
    return null
  }
}

/**
 * Dispatches one already-persisted outbox intent using an explicitly injected
 * provider adapter. This module has no built-in network client and cannot send
 * unless the caller supplies an adapter for the exact provider/channel pair.
 */
export async function dispatchChannelOutboundMessage(
  outboundId: string,
  adapters: ChannelProviderAdapters
): Promise<DispatchResult> {
  const claimed = await claimChannelOutboundMessage(outboundId)
  if (!claimed) return { status: 'not_claimed' }

  const outbound = await db.channelOutboundMessage.findUnique({
    where: { id: outboundId },
    include: {
      conversation: {
        include: {
          connection: {
            select: {
              id: true,
              organizationId: true,
              channel: true,
              provider: true,
              externalAccountId: true,
              credentialsEnc: true,
              status: true,
            },
          },
        },
      },
    },
  })

  const conversation = outbound?.conversation
  const connection = conversation?.connection
  if (
    !outbound ||
    !conversation ||
    !connection ||
    conversation.organizationId !== connection.organizationId ||
    conversation.status !== 'active' ||
    connection.status !== 'connected' ||
    conversation.channel !== connection.channel
  ) {
    await markChannelOutboundFailed(outboundId, 'CONNECTION_VALIDATION_FAILED')
    return { status: 'failed', errorCode: 'CONNECTION_VALIDATION_FAILED' }
  }

  const key = adapterKey(connection.provider, connection.channel)
  const adapter = adapters[key]
  if (!adapter) {
    await markChannelOutboundFailed(outboundId, 'ADAPTER_UNAVAILABLE')
    return { status: 'failed', errorCode: 'ADAPTER_UNAVAILABLE' }
  }

  // Secrets are decrypted only after tenant, status, channel and provider lookup.
  const credentials = readCredentials(connection.credentialsEnc)
  if (!credentials) {
    await markChannelOutboundFailed(outboundId, 'CREDENTIALS_INVALID')
    return { status: 'failed', errorCode: 'CREDENTIALS_INVALID' }
  }

  try {
    const result = await adapter({
      channel: connection.channel,
      provider: connection.provider,
      externalAccountId: connection.externalAccountId,
      recipientKey: conversation.externalContactKey,
      body: outbound.body,
      credentials,
    })
    if (result.ok) {
      const message = await markChannelOutboundSent({
        id: outboundId,
        providerMessageId: result.providerMessageId ?? null,
      })
      return { status: 'sent', messageId: message.id }
    }
    if (result.definitive) {
      const errorCode = /^[A-Z0-9_.-]{1,64}$/.test(result.errorCode)
        ? result.errorCode
        : 'PROVIDER_REJECTED'
      await markChannelOutboundFailed(outboundId, errorCode)
      return { status: 'failed', errorCode }
    }
    const errorCode = result.errorCode && /^[A-Z0-9_.-]{1,64}$/.test(result.errorCode)
      ? result.errorCode
      : 'DELIVERY_UNCERTAIN'
    await markChannelOutboundUnknown(outboundId, errorCode)
    return { status: 'unknown', errorCode }
  } catch {
    // A thrown network error may happen after provider acceptance; never retry blind.
    const errorCode = 'PROVIDER_RESULT_UNCERTAIN'
    await markChannelOutboundUnknown(outboundId, errorCode)
    return { status: 'unknown', errorCode }
  }
}
