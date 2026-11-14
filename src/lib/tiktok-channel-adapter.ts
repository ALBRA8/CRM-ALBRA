import type { ChannelProviderAdapter, ChannelProviderAdapters } from '@/lib/channel-outbound-dispatcher'
import { sendTikTokBusinessMessage } from '@/lib/integrations'

/**
 * TikTok Business Messaging adapter. The outbox supplies the canonical
 * provider conversation ID as recipientKey and the connected Business
 * account open_id as externalAccountId.
 */
export function createTikTokChannelAdapters(fetchImpl: typeof fetch = fetch): ChannelProviderAdapters {
  const adapter: ChannelProviderAdapter = async (input) => {
    if (
      input.channel !== 'tiktok' ||
      input.provider !== 'tiktok_business' ||
      !input.credentials.accessToken ||
      !/^[A-Za-z0-9._:-]{5,128}$/.test(input.externalAccountId) ||
      !/^[A-Za-z0-9._:-]{5,255}$/.test(input.recipientKey) ||
      !input.body.trim()
    ) return { ok: false, definitive: true, errorCode: 'TIKTOK_INVALID_PROVIDER_INPUT' }

    const result = await sendTikTokBusinessMessage({
      state: { accessToken: input.credentials.accessToken, openId: input.externalAccountId },
      conversationId: input.recipientKey,
      text: input.body,
      fetchImpl,
    })
    if (result.ok && result.providerMessageId) {
      return { ok: true, providerMessageId: result.providerMessageId }
    }
    const errorCode = (result.error || 'TIKTOK_SEND_FAILED').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64).toUpperCase()
    if (result.notAuthorized || /^HTTP_4(?!29)\d{2}$/.test(errorCode) || /^TIKTOK_CODE_\d+$/.test(errorCode)) {
      return { ok: false, definitive: true, errorCode }
    }
    return { ok: false, definitive: false, errorCode }
  }
  return { 'tiktok_business:tiktok': adapter }
}
