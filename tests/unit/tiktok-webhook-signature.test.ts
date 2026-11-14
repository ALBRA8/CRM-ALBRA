import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isTikTokWebhookTimestampFresh, sendTikTokBusinessMessage, refreshTikTokUserAccessToken, verifyTikTokSignature } from '@/lib/integrations'
import { extractTikTokMessage } from '@/app/api/tiktok/webhook/route'

const fakeAccessToken = ['test', 'access', 'token'].join('-')
const fakeBusinessId = ['business', 'open', 'id'].join('-')

describe('TikTok webhook signature freshness', () => {
  it('accepts a recent timestamp and rejects stale or excessively future timestamps', () => {
    const now = Date.now()
    expect(isTikTokWebhookTimestampFresh(String(Math.floor((now - 60_000) / 1000)), now)).toBe(true)
    expect(isTikTokWebhookTimestampFresh(String(Math.floor((now - 6 * 60_000) / 1000)), now)).toBe(false)
    expect(isTikTokWebhookTimestampFresh(String(Math.floor((now + 60_000) / 1000)), now)).toBe(false)
    expect(isTikTokWebhookTimestampFresh('not-a-timestamp', now)).toBe(false)
  })

  it('binds the HMAC to the timestamp and exact raw body', () => {
    const now = Date.now()
    const timestamp = String(Math.floor(now / 1000))
    const rawBody = JSON.stringify({ event_id: 'evt_synthetic_1', event: 'message' })
    const secret = 'synthetic-tiktok-app-secret' // scan-secrets:allow — fixture sintético exclusivo de test HMAC
    const signature = createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex')
    const header = `t=${timestamp},s=${signature}`

    expect(verifyTikTokSignature(rawBody, secret, header)).toBe(true)
    expect(verifyTikTokSignature(rawBody + ' ', secret, header)).toBe(false)
    const stale = String(Math.floor((now - 10 * 60_000) / 1000))
    const staleSignature = createHmac('sha256', secret).update(stale + '.' + rawBody).digest('hex')
    expect(verifyTikTokSignature(rawBody, secret, `t=${stale},s=${staleSignature}`)).toBe(false)
  })
})

describe('TikTok OAuth refresh contract', () => {
  it('rotates the refresh token and records both expiry timestamps', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const now = 1_800_000_000_000
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({
        access_token: 'synthetic-new-access-token', // scan-secrets:allow — token OAuth sintético de test
        expires_in: 7200,
        refresh_token: 'synthetic-rotated-refresh-token',
        refresh_expires_in: 15_552_000,
        open_id: 'synthetic-open-id',
        scope: 'user.info.basic',
        token_type: 'Bearer',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const result = await refreshTikTokUserAccessToken({
      state: {
        appKey: 'synthetic-client-key',
        appSecret: 'synthetic-client-secret', // scan-secrets:allow — secreto OAuth sintético de test
        accessToken: 'synthetic-old-access-token', // scan-secrets:allow — token OAuth sintético de test
        refreshToken: 'synthetic-old-refresh-token',
        openId: 'synthetic-open-id',
      },
      fetchImpl,
      now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(requestUrl).toBe('https://open.tiktokapis.com/v2/oauth/token/')
    expect(requestInit?.method).toBe('POST')
    expect(requestInit?.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
    const body = new URLSearchParams(String(requestInit?.body))
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('synthetic-old-refresh-token')
    expect(result.state.accessToken).toBe('synthetic-new-access-token')
    expect(result.state.refreshToken).toBe('synthetic-rotated-refresh-token')
    expect(result.state.accessTokenExpiresAt).toBe(now + 7_200_000)
    expect(result.state.refreshTokenExpiresAt).toBe(now + 15_552_000_000)
  })

  it('requires reauthorization when TikTok rejects an expired refresh token', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'refresh token expired',
    }), { status: 400 })
    const result = await refreshTikTokUserAccessToken({
      state: { appKey: 'synthetic-client-key', appSecret: 'synthetic-client-secret', refreshToken: 'synthetic-expired-refresh-token' }, // scan-secrets:allow — credenciales OAuth sintéticas de test
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      error: 'TIKTOK_REFRESH_INVALID_GRANT',
      reauthorizationRequired: true,
    })
  })
})

describe('TikTok Business Messaging send contract', () => {
  it('sends the documented conversation payload and requires the provider message ID', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        data: { message: { message_id: 'tiktok-message-123' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const result = await sendTikTokBusinessMessage({
      state: { accessToken: fakeAccessToken, openId: fakeBusinessId },
      conversationId: 'conversation-123',
      text: 'Hola desde CRM',
      fetchImpl,
    })

    expect(result).toEqual({ ok: true, providerMessageId: 'tiktok-message-123' })
    expect(requestUrl).toBe('https://business-api.tiktok.com/open_api/v1.3/business/message/send/')
    expect(requestInit?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Access-Token': fakeAccessToken,
    })
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      business_id: fakeBusinessId,
      recipient_type: 'CONVERSATION',
      recipient: 'conversation-123',
      message_type: 'TEXT',
      text: { body: 'Hola desde CRM' },
    })
  })

  it('does not treat a 2xx without message_id as a confirmed send', async () => {
    const fetchImpl: typeof fetch = async () => new Response(
      JSON.stringify({ code: 0, message: 'OK', data: { message: { message_id: '' } } }),
      { status: 200 },
    )
    const result = await sendTikTokBusinessMessage({
      state: { accessToken: fakeAccessToken, openId: fakeBusinessId },
      conversationId: 'conversation-123',
      text: 'Hola',
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, error: 'TIKTOK_RESPONSE_MISSING_MESSAGE_ID' })
  })
})


describe('TikTok inbound message identity parsing', () => {
  it('keeps sender and conversation IDs separate', () => {
    expect(extractTikTokMessage({
      message: { sender: { id: 'person-123' }, conversation_id: 'conversation-456', text: 'Hola' },
    })).toEqual({
      senderId: 'person-123',
      conversationId: 'conversation-456',
      text: 'Hola',
    })
  })

  it('never substitutes conversation ID for a missing sender identity', () => {
    expect(extractTikTokMessage({
      message: { conversation_id: 'conversation-456', text: 'Hola' },
    })).toBeNull()
  })

  it('parses the Business Messaging content envelope without conflating account, sender and conversation IDs', () => {
    expect(extractTikTokMessage({
      client_key: 'synthetic-client-key',
      user_openid: 'business-open-id',
      event: 'DIRECT_MESSAGE',
      content: JSON.stringify({
        message: {
          sender: { open_id: 'person-789' },
          conversation_id: 'conversation-987',
          message_id: 'provider-message-789',
          text: 'Mensaje desde envelope',
        },
      }),
    })).toEqual({
      senderId: 'person-789',
      conversationId: 'conversation-987',
      text: 'Mensaje desde envelope',
      providerMessageId: 'provider-message-789',
    })
  })

  it('rejects messages without a provider conversation ID instead of creating an unthreaded CRM event', () => {
    expect(extractTikTokMessage({
      message: { sender: { id: 'person-123' }, text: 'Hola' },
    })).toBeNull()
  })
})
