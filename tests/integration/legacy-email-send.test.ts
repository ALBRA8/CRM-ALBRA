import { describe, expect, it, vi } from 'vitest'
import { POST as smtpSendPOST } from '@/app/api/email/send/route'
import { POST as gmailSendPOST } from '@/app/api/google/gmail/send/route'
import { jsonBody, req, tokenA } from '../helpers'

const providerMocks = vi.hoisted(() => ({
  getSmtpConfig: vi.fn(),
  trySendSmtp: vi.fn(),
  getAccessToken: vi.fn(),
  sendGmailMessage: vi.fn(),
}))

vi.mock('@/lib/mail', () => ({
  getSmtpConfig: providerMocks.getSmtpConfig,
  trySendSmtp: providerMocks.trySendSmtp,
}))
vi.mock('@/lib/google', () => ({
  getAccessToken: providerMocks.getAccessToken,
  sendGmailMessage: providerMocks.sendGmailMessage,
}))

describe('legacy email send endpoints fail closed', () => {
  it('SMTP manual send is rejected without invoking the provider', async () => {
    const res = await smtpSendPOST(req('/api/email/send', {
      method: 'POST',
      token: tokenA(),
      body: { to: 'test@example.invalid', subject: 'No send', text: 'Must remain queued' },
    }))
    expect(res.status).toBe(409)
    expect(await jsonBody(res)).toMatchObject({ code: 'LEGACY_EMAIL_SEND_DISABLED' })
    expect(providerMocks.getSmtpConfig).not.toHaveBeenCalled()
    expect(providerMocks.trySendSmtp).not.toHaveBeenCalled()
  })

  it('Gmail direct send is rejected without obtaining a token or invoking the provider', async () => {
    const res = await gmailSendPOST(req('/api/google/gmail/send', {
      method: 'POST',
      token: tokenA(),
      body: { to: 'test@example.invalid', subject: 'No send', html: '<p>Must remain queued</p>' },
    }))
    expect(res.status).toBe(409)
    expect(await jsonBody(res)).toMatchObject({ code: 'LEGACY_GMAIL_SEND_DISABLED' })
    expect(providerMocks.getAccessToken).not.toHaveBeenCalled()
    expect(providerMocks.sendGmailMessage).not.toHaveBeenCalled()
  })
})
