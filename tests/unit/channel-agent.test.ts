import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/lib/prompts/sales-strategy', () => ({ SALES_STRATEGY_PROMPT: '' }))

import { llmReplyOrNotification } from '@/lib/channel-agent'

describe('channel agent delivery failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.llmChat.mockResolvedValue('Respuesta generada')
    mocks.buildKnowledgeContext.mockResolvedValue('')
    mocks.recallContext.mockResolvedValue('')
    mocks.recallStyleLessons.mockResolvedValue('')
    mocks.rememberMessage.mockResolvedValue(undefined)
  })

  it('propaga fallos del proveedor para que el webhook pueda reintentar', async () => {
    const send = vi.fn().mockRejectedValue(new Error('provider unavailable'))

    await expect(llmReplyOrNotification({
      orgId: 'org-test',
      clientId: null,
      channelLabel: 'Messenger',
      incomingText: 'Hola',
      handoffKeywords: [],
      nichoContext: '',
      send,
    })).rejects.toThrow('provider unavailable')

    expect(send).toHaveBeenCalledWith('Respuesta generada')
    expect(mocks.rememberMessage).not.toHaveBeenCalled()
  })

  it('degrada un fallo de generación IA sin tratarlo como fallo de entrega', async () => {
    mocks.llmChat.mockRejectedValue(new Error('model unavailable'))
    const send = vi.fn()

    await expect(llmReplyOrNotification({
      orgId: 'org-test',
      clientId: null,
      channelLabel: 'Messenger',
      incomingText: 'Hola',
      handoffKeywords: [],
      nichoContext: '',
      send,
    })).resolves.toMatchObject({ replied: false, handoff: false })

    expect(send).not.toHaveBeenCalled()
  })
})
