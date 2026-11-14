import { describe, expect, it, vi } from 'vitest'
import { createMetaChannelAdapters } from '@/lib/meta-channel-adapters'

function fakeFetch(status: number, payload: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
  ) as unknown as typeof fetch
}

const base = {
  provider: 'meta_cloud',
  channel: 'whatsapp',
  externalAccountId: '123456789012345',
  recipientKey: '573001234567',
  body: 'Hola desde pruebas',
  outboundId: 'outbound_test_123',
  credentials: { accessToken: ['mock', 'credential', 'fixture'].join('-') },
}

describe('Meta canonical channel adapters (mock fetch only)', () => {
  it('treats a successful HTTP response without provider message id as ambiguous', async () => {
    const fetchMock = fakeFetch(200, { messages: [] })
    const adapter = createMetaChannelAdapters(fetchMock)['meta_cloud:whatsapp']
    const result = await adapter(base)
    expect(result).toEqual({ ok: false, definitive: false, errorCode: 'META_RESPONSE_MISSING_MESSAGE_ID' })
  })

  it('sends WhatsApp Cloud text to the exact phone-number connection', async () => {
    const fetchMock = fakeFetch(200, { messages: [{ id: 'wamid.mock' }] })
    const adapter = createMetaChannelAdapters(fetchMock)['meta_cloud:whatsapp']
    const result = await adapter(base)
    expect(result).toEqual({ ok: true, providerMessageId: 'wamid.mock' })
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/123456789012345/messages')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${base.credentials.accessToken}` })
    expect(init.body).toBe(JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '573001234567',
      type: 'text',
      text: { preview_url: false, body: 'Hola desde pruebas' },
      biz_opaque_callback_data: 'outbound_test_123',
    }))
    expect(url).not.toContain(base.credentials.accessToken)
  })

  it('sends Instagram text using the exact Instagram account and IGSID', async () => {
    const fetchMock = fakeFetch(200, { message_id: 'ig.mock' })
    const adapter = createMetaChannelAdapters(fetchMock)['meta_graph:instagram']
    const result = await adapter({ ...base, provider: 'meta_graph', channel: 'instagram', recipientKey: '17840000000000000' })
    expect(result).toEqual({ ok: true, providerMessageId: 'ig.mock' })
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/123456789012345/messages')
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: '17840000000000000' },
      messaging_type: 'RESPONSE',
      message: { text: 'Hola desde pruebas' },
    })
  })

  it('sends Messenger text through the exact Page and PSID', async () => {
    const fetchMock = fakeFetch(200, { recipient_id: '123456789012345', message_id: 'mid.messenger.mock' })
    const adapter = createMetaChannelAdapters(fetchMock)['meta_graph:messenger']
    const result = await adapter({
      ...base,
      provider: 'meta_graph',
      channel: 'messenger',
      externalAccountId: '123456789012345',
      recipientKey: '987654321098765',
    })
    expect(result).toEqual({ ok: true, providerMessageId: 'mid.messenger.mock' })
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/123456789012345/messages')
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: '987654321098765' },
      messaging_type: 'RESPONSE',
      message: { text: 'Hola desde pruebas' },
    })
    expect(url).not.toContain(base.credentials.accessToken)
  })

  it('treats a Messenger 2xx without message_id as ambiguous', async () => {
    const adapter = createMetaChannelAdapters(fakeFetch(200, { recipient_id: '987654321098765' }))['meta_graph:messenger']
    expect(await adapter({
      ...base,
      provider: 'meta_graph',
      channel: 'messenger',
    })).toEqual({ ok: false, definitive: false, errorCode: 'META_RESPONSE_MISSING_MESSAGE_ID' })
  })

  it('marks Meta 5xx responses as ambiguous, not definitive failure', async () => {
    const adapter = createMetaChannelAdapters(fakeFetch(503, { error: { code: 2 } }))['meta_cloud:whatsapp']
    expect(await adapter(base)).toEqual({ ok: false, definitive: false, errorCode: 'META_HTTP_503' })
  })

  it('marks an explicit Meta 4xx rejection as definitive', async () => {
    const adapter = createMetaChannelAdapters(fakeFetch(400, { error: { code: 100 } }))['meta_cloud:whatsapp']
    expect(await adapter(base)).toEqual({ ok: false, definitive: true, errorCode: 'META_ERROR_100' })
  })
})
