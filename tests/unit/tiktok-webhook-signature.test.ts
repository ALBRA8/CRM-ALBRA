import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isTikTokWebhookTimestampFresh, sendTikTokBusinessMessage, verifyTikTokSignature } from '@/lib/integrations'

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
    const signature = createHmac('sha256', secret).update(timestamp + rawBody).digest('hex')

    expect(verifyTikTokSignature(rawBody, secret, signature, timestamp)).toBe(true)
    expect(verifyTikTokSignature(rawBody + ' ', secret, signature, timestamp)).toBe(false)
    expect(verifyTikTokSignature(rawBody, secret, signature, String(Math.floor((now - 10 * 60_000) / 1000)))).toBe(false)
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
      state: { accessToken: 'test-access-token', openId: 'business-open-id' },
      conversationId: 'conversation-123',
      text: 'Hola desde CRM',
      fetchImpl,
    })

    expect(result).toEqual({ ok: true, providerMessageId: 'tiktok-message-123' })
    expect(requestUrl).toBe('https://business-api.tiktok.com/open_api/v1.3/business/message/send/')
    expect(requestInit?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Access-Token': 'test-access-token',
    })
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      business_id: 'business-open-id',
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
      state: { accessToken: 'test-access-token', openId: 'business-open-id' },
      conversationId: 'conversation-123',
      text: 'Hola',
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, error: 'TIKTOK_RESPONSE_MISSING_MESSAGE_ID' })
  })
})
