import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isTikTokWebhookTimestampFresh, verifyTikTokSignature } from '@/lib/integrations'

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
