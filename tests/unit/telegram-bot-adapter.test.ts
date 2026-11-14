import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendTelegramBotMessage } from '@/lib/integrations'

const previousApiBase = process.env.TELEGRAM_API_BASE

afterEach(() => {
  vi.restoreAllMocks()
  if (previousApiBase === undefined) delete process.env.TELEGRAM_API_BASE
  else process.env.TELEGRAM_API_BASE = previousApiBase
})

describe('Telegram Bot API outbound adapter', () => {
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
