import { beforeEach, describe, expect, it, vi } from 'vitest'
import { llmReplyOrNotification } from '@/lib/channel-autoresponder'

const mocks = vi.hoisted(() => ({
  llmChat: vi.fn(),
  buildKnowledgeContext: vi.fn(),
  recallContext: vi.fn(),
  recallStyleLessons: vi.fn(),
  rememberMessage: vi.fn(),
  maybeConsolidate: vi.fn(),
  notifyOrganization: vi.fn(),
}))

vi.mock('@/lib/ai', () => ({ llmChat: mocks.llmChat }))
vi.mock('@/lib/knowledge', () => ({ buildKnowledgeContext: mocks.buildKnowledgeContext }))
vi.mock('@/lib/memory', () => ({
  recallContext: mocks.recallContext,
  recallStyleLessons: mocks.recallStyleLessons,
  rememberMessage: mocks.rememberMessage,
  maybeConsolidate: mocks.maybeConsolidate,
}))
vi.mock('@/lib/push', () => ({ notifyOrganization: mocks.notifyOrganization }))

const base = {
  orgId: 'org_test',
  clientId: 'client_test',
  channelLabel: 'Facebook',
  incomingText: 'Hola, quisiera información',
  handoffKeywords: ['asesor'],
  nichoContext: 'Contexto de prueba',
}

describe('llmReplyOrNotification delivery boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildKnowledgeContext.mockResolvedValue('')
    mocks.recallContext.mockResolvedValue('')
    mocks.recallStyleLessons.mockResolvedValue('')
    mocks.llmChat.mockResolvedValue('Respuesta de prueba')
    mocks.rememberMessage.mockResolvedValue(undefined)
  })

  it('propagates provider delivery errors so the webhook can retry', async () => {
    const deliveryError = new Error('provider unavailable')
    const send = vi.fn().mockRejectedValue(deliveryError)

    await expect(llmReplyOrNotification({ ...base, send })).rejects.toBe(deliveryError)
    expect(send).toHaveBeenCalledWith('Respuesta de prueba')
    expect(mocks.rememberMessage).not.toHaveBeenCalled()
  })

  it('degrades generation failures without attempting delivery', async () => {
    mocks.llmChat.mockRejectedValue(new Error('model unavailable'))
    const send = vi.fn()

    await expect(llmReplyOrNotification({ ...base, send })).resolves.toEqual({
      replied: false,
      handoff: false,
    })
    expect(send).not.toHaveBeenCalled()
  })
})
