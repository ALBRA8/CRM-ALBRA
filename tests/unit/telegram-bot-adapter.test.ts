import { createHmac } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isChannelAutoReplyGloballyEnabled, isTelegramAutoReplyEnabled, isTikTokWebhookTimestampFresh, verifyTikTokSignature, sendTelegramBotMessage } from '@/lib/integrations'

const previousApiBase = process.env.TELEGRAM_API_BASE

afterEach(() => {
  vi.restoreAllMocks()
  if (previousApiBase === undefined) delete process.env.TELEGRAM_API_BASE
  else process.env.TELEGRAM_API_BASE = previousApiBase
})

describe('TikTok webhook signature freshness', () => {
  it('accepts recent Unix-seconds timestamps from TikTok', () => {
    const now = 1_800_000_000_000
    expect(isTikTokWebhookTimestampFresh(String(Math.floor(now / 1000)), now)).toBe(true)
  })

  it('rejects missing, malformed, stale and future timestamps', () => {
    const now = 1_800_000_000_000
    expect(isTikTokWebhookTimestampFresh(null, now)).toBe(false)
    expect(isTikTokWebhookTimestampFresh('not-a-timestamp', now)).toBe(false)
    expect(isTikTokWebhookTimestampFresh(String(Math.floor((now - 6 * 60 * 1000) / 1000)), now)).toBe(false)
    expect(isTikTokWebhookTimestampFresh(String(Math.floor((now + 60 * 1000) / 1000)), now)).toBe(false)
  })

  it('accepts a fresh timestamp bound to the signed body', () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = '{"event":"message"}'
    const secret = ['synthetic', 'tiktok', 'secret'].join('-')
    const signature = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex')
    expect(verifyTikTokSignature(body, secret, signature, timestamp)).toBe(true)
  })

  it('requires a fresh timestamp even when the body HMAC matches', () => {
    const body = '{"event":"message"}'
    const secret = ['synthetic', 'tiktok', 'secret'].join('-')
    const stale = String(Math.floor((Date.now() - 10 * 60 * 1000) / 1000))
    const signature = createHmac('sha256', secret).update(stale + '.' + body).digest('hex')
    expect(verifyTikTokSignature(body, secret, signature, stale)).toBe(false)
    expect(verifyTikTokSignature(body, secret, signature, null)).toBe(false)
  })
})

describe('Telegram Bot API outbound adapter', () => {
  it('keeps webhook auto-replies disabled unless the global channel flag is explicitly true', () => {
    const previous = process.env.CHANNEL_AUTOREPLY_ENABLED
    delete process.env.CHANNEL_AUTOREPLY_ENABLED
    expect(isChannelAutoReplyGloballyEnabled()).toBe(false)
    expect(isTelegramAutoReplyEnabled({ token: 'synthetic-token' })).toBe(false)
    process.env.CHANNEL_AUTOREPLY_ENABLED = 'true'
    expect(isChannelAutoReplyGloballyEnabled()).toBe(true)
    expect(isTelegramAutoReplyEnabled({ token: 'synthetic-token' })).toBe(true)
    expect(isTelegramAutoReplyEnabled({ token: 'synthetic-token', autoReply: false })).toBe(false)
    expect(isTelegramAutoReplyEnabled({ autoReply: true })).toBe(false)
    if (previous === undefined) delete process.env.CHANNEL_AUTOREPLY_ENABLED
    else process.env.CHANNEL_AUTOREPLY_ENABLED = previous
  })

  it('returns the provider message id after an acknowledged send', async () => {
    process.env.TELEGRAM_API_BASE = 'https://telegram.test'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 481 },
    }), { status: 200 }))

    const result = await sendTelegramBotMessage({
      token: 'synthetic-test-token',
      chatId: 12345,
      text: 'mensaje de prueba',
    })

    expect(result).toEqual({ ok: true, messageId: '481' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://telegram.test/botsynthetic-test-token/sendMessage')
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      chat_id: 12345,
      text: 'mensaje de prueba',
    })
  })

  it('does not report success when Telegram omits the message id', async () => {
    process.env.TELEGRAM_API_BASE = 'https://telegram.test'
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }))

    const result = await sendTelegramBotMessage({
      token: 'synthetic-test-token',
      chatId: 12345,
      text: 'mensaje ambiguo',
    })

    expect(result.ok).toBe(false)
  })
})
