import { GRAPH_VERSION } from '@/lib/meta-oauth'
import type { ChannelProviderAdapter, ChannelProviderAdapters } from '@/lib/channel-outbound-dispatcher'

const GRAPH_BASE = 'https://graph.facebook.com'

interface MetaSendResponse {
  messages?: Array<{ id?: string }>
  message_id?: string
  error?: { code?: number }
}

function makeMetaAdapter(
  channel: 'whatsapp' | 'instagram',
  fetchImpl: typeof fetch
): ChannelProviderAdapter {
  return async (input) => {
    if (!input.credentials.accessToken || !/^\d{5,30}$/.test(input.externalAccountId) || !input.recipientKey) {
      return { ok: false, definitive: true, errorCode: 'INVALID_PROVIDER_INPUT' }
    }

    const endpoint = channel === 'whatsapp'
      ? `${GRAPH_BASE}/${GRAPH_VERSION}/${encodeURIComponent(input.externalAccountId)}/messages`
      : `${GRAPH_BASE}/${GRAPH_VERSION}/${encodeURIComponent(input.externalAccountId)}/messages`

    const payload = channel === 'whatsapp'
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.recipientKey,
          type: 'text',
          text: { preview_url: false, body: input.body },
        }
      : {
          recipient: { id: input.recipientKey },
          messaging_type: 'RESPONSE',
          message: { text: input.body },
        }

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await response.json().catch(() => ({})) as MetaSendResponse
    if (response.ok) {
      const providerMessageId = channel === 'whatsapp' ? data.messages?.[0]?.id : data.message_id
      return { ok: true, providerMessageId: providerMessageId ?? null }
    }

    // 5xx and rate limiting may occur after provider-side processing; quarantine.
    if (response.status >= 500 || response.status === 429) {
      return { ok: false, definitive: false, errorCode: `META_HTTP_${response.status}` }
    }
    const providerCode = typeof data.error?.code === 'number' ? data.error.code : response.status
    return { ok: false, definitive: true, errorCode: `META_ERROR_${providerCode}` }
  }
}

/**
 * Official Meta Graph text adapters. They are intentionally only a factory:
 * no route/worker registers or invokes them until outbound sending is approved.
 */
export function createMetaChannelAdapters(fetchImpl: typeof fetch = fetch): ChannelProviderAdapters {
  return {
    'meta_cloud:whatsapp': makeMetaAdapter('whatsapp', fetchImpl),
    'meta_graph:instagram': makeMetaAdapter('instagram', fetchImpl),
  }
}
