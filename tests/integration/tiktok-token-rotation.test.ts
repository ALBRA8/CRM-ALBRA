import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { parseTikTokState } from '@/lib/integrations'
import { prepareTikTokAccessTokenForSend } from '@/lib/tiktok-token-rotation'
import { createChannelOutboundIntent } from '@/lib/channel-outbox'
import { dispatchChannelOutboundMessage } from '@/lib/channel-outbound-dispatcher'
import { FIX } from '../setup/seed-data'

const connectionIds: string[] = []
const conversationIds: string[] = []
const now = 1_800_000_000_000
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

afterEach(async () => {
  vi.unstubAllGlobals()
  if (conversationIds.length) {
    await db.channelOutboundMessage.deleteMany({ where: { conversationId: { in: conversationIds } } })
    await db.channelMessage.deleteMany({ where: { conversationId: { in: conversationIds } } })
    await db.channelConversation.deleteMany({ where: { id: { in: conversationIds } } })
    conversationIds.length = 0
  }
  if (connectionIds.length) {
    await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
    connectionIds.length = 0
  }
})

async function createConnection(overrides: { refreshState?: string; refreshLeaseToken?: string | null; refreshLeaseExpiresAt?: Date | null; refreshFencingVersion?: number } = {}) {
  const id = `tiktok-refresh-${suffix()}`
  const state = {
    accessToken: ['synthetic', 'old', 'access', 'token'].join('-'),
    refreshToken: ['synthetic', 'old', 'refresh', 'token'].join('-'),
    accessTokenExpiresAt: now - 60_000,
    refreshTokenExpiresAt: now + 86_400_000,
    appKey: 'synthetic-client-key',
    appSecret: ['synthetic', 'client', 'secret'].join('-'),
    openId: 'synthetic-business-open-id',
  }
  const connection = await db.channelConnection.create({
    data: {
      id,
      organizationId: FIX.orgA.id,
      channel: 'tiktok',
      provider: 'tiktok_business',
      providerAccountKey: `tiktok:refresh:${id}`,
      externalAccountId: 'synthetic-business-open-id',
      credentialsEnc: encryptSecret(JSON.stringify(state))!,
      status: 'connected',
      ...overrides,
    },
  })
  connectionIds.push(connection.id)
  return connection
}

function rotatedResponse() {
  return new Response(JSON.stringify({
    access_token: ['synthetic', 'new', 'access', 'token'].join('-'),
    expires_in: 7200,
    refresh_token: ['synthetic', 'rotated', 'refresh', 'token'].join('-'),
    refresh_expires_in: 15_552_000,
    open_id: 'synthetic-business-open-id',
    scope: 'user.info.basic',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('TikTok durable OAuth refresh lease', () => {
  it('persists both rotated tokens before returning the access token', async () => {
    const connection = await createConnection()
    let calls = 0
    const fetchImpl: typeof fetch = async () => { calls += 1; return rotatedResponse() }

    const result = await prepareTikTokAccessTokenForSend(connection.id, now, fetchImpl)
    const stored = await db.channelConnection.findUnique({ where: { id: connection.id } })
    const state = parseTikTokState(stored?.credentialsEnc)

    expect(result).toEqual({ ok: true, accessToken: ['synthetic', 'new', 'access', 'token'].join('-') })
    expect(calls).toBe(1)
    expect(state.refreshToken).toBe(['synthetic', 'rotated', 'refresh', 'token'].join('-'))
    expect(state.accessTokenExpiresAt).toBe(now + 7_200_000)
    expect(stored).toMatchObject({
      refreshState: 'idle',
      refreshLeaseToken: null,
      refreshLeaseExpiresAt: null,
      refreshFencingVersion: 1,
      tokenExpiresAt: new Date(now + 7_200_000),
    })
  })

  it('uses the durably rotated access token before invoking the TikTok send adapter', async () => {
    const connection = await createConnection()
    const conversation = await db.channelConversation.create({
      data: {
        organizationId: FIX.orgA.id,
        connectionId: connection.id,
        channel: 'tiktok',
        externalContactKey: 'synthetic-conversation-id',
      },
    })
    conversationIds.push(conversation.id)
    const intent = await createChannelOutboundIntent({
      organizationId: FIX.orgA.id,
      conversationId: conversation.id,
      clientRequestId: 'tiktok-refresh-dispatch-01',
      body: 'Mensaje con token renovado',
    })
    vi.stubGlobal('fetch', async () => rotatedResponse())

    let adapterToken = ''
    let persistedRefreshToken = ''
    const result = await dispatchChannelOutboundMessage(intent.id, {
      'tiktok_business:tiktok': async (input) => {
        adapterToken = input.credentials.accessToken
        const stored = await db.channelConnection.findUnique({ where: { id: connection.id } })
        persistedRefreshToken = parseTikTokState(stored?.credentialsEnc).refreshToken || ''
        return { ok: true, providerMessageId: 'synthetic-provider-message-id' }
      },
    })

    expect(result.status).toBe('sent')
    expect(adapterToken).toBe(['synthetic', 'new', 'access', 'token'].join('-'))
    expect(persistedRefreshToken).toBe(['synthetic', 'rotated', 'refresh', 'token'].join('-'))
  })

  it('allows at most one provider refresh across concurrent workers', async () => {
    const connection = await createConnection()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return rotatedResponse()
    }

    const results = await Promise.all([
      prepareTikTokAccessTokenForSend(connection.id, now, fetchImpl),
      prepareTikTokAccessTokenForSend(connection.id, now, fetchImpl),
    ])
    expect(calls).toBe(1)
    expect(results.some((result) => result.ok)).toBe(true)
    const stored = await db.channelConnection.findUnique({ where: { id: connection.id } })
    expect(stored?.refreshFencingVersion).toBe(1)
  })

  it('quarantines network uncertainty and never reuses the old refresh token automatically', async () => {
    const connection = await createConnection()
    let calls = 0
    const fetchImpl: typeof fetch = async () => { calls += 1; throw new Error('simulated timeout') }

    const first = await prepareTikTokAccessTokenForSend(connection.id, now, fetchImpl)
    const second = await prepareTikTokAccessTokenForSend(connection.id, now, fetchImpl)
    const stored = await db.channelConnection.findUnique({ where: { id: connection.id } })

    expect(first).toEqual({ ok: false, errorCode: 'TIKTOK_REFRESH_UNCERTAIN' })
    expect(second).toEqual({ ok: false, errorCode: 'TIKTOK_REFRESH_UNCERTAIN' })
    expect(calls).toBe(1)
    expect(stored?.refreshState).toBe('uncertain')
    expect(parseTikTokState(stored?.credentialsEnc).refreshToken).toBe(['synthetic', 'old', 'refresh', 'token'].join('-'))
  })

  it('requires reconnection on invalid_grant', async () => {
    const connection = await createConnection()
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'synthetic expired token',
    }), { status: 400 })

    const result = await prepareTikTokAccessTokenForSend(connection.id, now, fetchImpl)
    const stored = await db.channelConnection.findUnique({ where: { id: connection.id } })
    expect(result).toEqual({ ok: false, errorCode: 'TIKTOK_RECONNECT_REQUIRED' })
    expect(stored?.status).toBe('reconnect_required')
    expect(stored?.refreshState).toBe('uncertain')
  })

  it('does not reclaim an expired refreshing lease', async () => {
    const connection = await createConnection({
      refreshState: 'refreshing',
      refreshLeaseToken: 'prior-worker-token',
      refreshLeaseExpiresAt: new Date(now - 60_000),
      refreshFencingVersion: 9,
    })
    let calls = 0
    const fetchImpl: typeof fetch = async () => { calls += 1; return rotatedResponse() }

    const result = await prepareTikTokAccessTokenForSend(connection.id, now, fetchImpl)
    expect(result).toEqual({ ok: false, errorCode: 'TIKTOK_REFRESH_IN_PROGRESS' })
    expect(calls).toBe(0)
    expect((await db.channelConnection.findUnique({ where: { id: connection.id } }))?.refreshFencingVersion).toBe(9)
  })
})
