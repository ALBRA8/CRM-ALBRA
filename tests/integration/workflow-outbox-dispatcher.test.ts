import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { enqueueWorkflowOutboundMessage, enqueueTelegramWebhookReply, dispatchWorkflowOutboundMessage, quarantineStaleWorkflowOutboundMessages } from '@/lib/workflow-outbox'
import { FIX } from '../setup/seed-data'
import { encodeTelegramState } from '@/lib/integrations'

const pairs: Array<{ automationId: string; runId: string }> = []
const outboundIds: string[] = []
const previousDaemonUrl = process.env.WHATSAPP_DAEMON_URL
const previousInternalSecret = process.env.INTERNAL_API_SECRET
const testDaemonSecret = ['test', 'internal', 'secret', '0123456789'].join('-')

async function createRun(label: string) {
  const automation = await db.automation.create({
    data: { organizationId: FIX.orgA.id, name: label, triggerType: 'manual', isActive: true, actions: '[]' },
  })
  const run = await db.automationRun.create({
    data: { organizationId: FIX.orgA.id, automationId: automation.id, status: 'running' },
  })
  pairs.push({ automationId: automation.id, runId: run.id })
  return { automationId: automation.id, automationRunId: run.id }
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousDaemonUrl === undefined) delete process.env.WHATSAPP_DAEMON_URL
  else process.env.WHATSAPP_DAEMON_URL = previousDaemonUrl
  if (previousInternalSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousInternalSecret
  if (outboundIds.length) await db.workflowOutboundMessage.deleteMany({ where: { id: { in: outboundIds } } })
  outboundIds.length = 0
  for (const pair of pairs) {
    await db.automationRun.deleteMany({ where: { id: pair.runId } })
    await db.automation.deleteMany({ where: { id: pair.automationId } })
  }
  pairs.length = 0
})

describe('Telegram webhook auto-reply outbox', () => {
  it('persists an encrypted intent once per organization and Telegram update_id', async () => {
    const input = {
      organizationId: FIX.orgA.id,
      updateId: 765432109,
      chatId: 123456789,
      text: 'respuesta automática simulada',
    }
    const first = await enqueueTelegramWebhookReply(input)
    outboundIds.push(first.id)
    const duplicate = await enqueueTelegramWebhookReply(input)
    expect(duplicate.id).toBe(first.id)
    expect(first).toMatchObject({
      organizationId: FIX.orgA.id,
      automationId: null,
      automationRunId: null,
      stepIndex: 0,
      idempotencyKey: 'telegram-webhook:765432109',
      channel: 'telegram',
      status: 'queued',
      attemptCount: 0,
    })
    expect(first.payloadEnc).not.toContain(input.text)
    const retryWithDifferentLlmWording = await enqueueTelegramWebhookReply({ ...input, text: 'contenido distinto' })
    expect(retryWithDifferentLlmWording.id).toBe(first.id)
    await expect(enqueueTelegramWebhookReply({ ...input, chatId: 987654321 }))
      .rejects.toThrow('WORKFLOW_OUTBOX_IDEMPOTENCY_CONFLICT')
    expect(await db.workflowOutboundMessage.count({
      where: { organizationId: FIX.orgA.id, idempotencyKey: 'telegram-webhook:765432109' },
    })).toBe(1)
  })

  it('dispatches a queued Telegram reply only after provider acknowledgement', async () => {
    const previousFlag = process.env.CHANNEL_AUTOREPLY_ENABLED
    const previousApiBase = process.env.TELEGRAM_API_BASE
    const previousIntegration = await db.integration.findUnique({
      where: { organizationId: FIX.orgA.id },
      select: { telegramBotTokenEnc: true },
    })
    const tokenEnc = encodeTelegramState({ token: 'synthetic-telegram-test-token', autoReply: true })
    if (!tokenEnc) throw new Error('test encryption unavailable')
    await db.integration.upsert({
      where: { organizationId: FIX.orgA.id },
      create: { organizationId: FIX.orgA.id, telegramBotTokenEnc: tokenEnc },
      update: { telegramBotTokenEnc: tokenEnc },
    })
    process.env.CHANNEL_AUTOREPLY_ENABLED = 'true'
    process.env.TELEGRAM_API_BASE = 'https://telegram.test'
    const intent = await enqueueTelegramWebhookReply({
      organizationId: FIX.orgA.id,
      updateId: 765432111,
      chatId: 123456789,
      text: 'respuesta para despachar',
    })
    outboundIds.push(intent.id)
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 90210 },
    }), { status: 200 }))
    try {
      expect(await dispatchWorkflowOutboundMessage(intent.id)).toEqual({ status: 'sent' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0][0])).toBe('https://telegram.test/botsynthetic-telegram-test-token/sendMessage')
      expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
        chat_id: 123456789,
        text: 'respuesta para despachar',
      })
      const stored = await db.workflowOutboundMessage.findUnique({ where: { id: intent.id } })
      expect(stored).toMatchObject({ status: 'sent', providerMessageId: '90210', attemptCount: 1 })
    } finally {
      if (previousFlag === undefined) delete process.env.CHANNEL_AUTOREPLY_ENABLED
      else process.env.CHANNEL_AUTOREPLY_ENABLED = previousFlag
      if (previousApiBase === undefined) delete process.env.TELEGRAM_API_BASE
      else process.env.TELEGRAM_API_BASE = previousApiBase
      if (previousIntegration) {
        await db.integration.update({
          where: { organizationId: FIX.orgA.id },
          data: { telegramBotTokenEnc: previousIntegration.telegramBotTokenEnc },
        })
      } else {
        await db.integration.deleteMany({ where: { organizationId: FIX.orgA.id } })
      }
    }
  })

  it('keeps a queued Telegram auto-reply unclaimed while the global kill switch is off', async () => {
    const intent = await enqueueTelegramWebhookReply({
      organizationId: FIX.orgA.id,
      updateId: 765432110,
      chatId: 123456789,
      text: 'respuesta pendiente',
    })
    outboundIds.push(intent.id)
    const previousFlag = process.env.CHANNEL_AUTOREPLY_ENABLED
    const existingIntegration = await db.integration.findUnique({
      where: { organizationId: FIX.orgA.id },
      select: { id: true },
    })
    delete process.env.CHANNEL_AUTOREPLY_ENABLED
    const fetchSpy = vi.spyOn(global, 'fetch')
    try {
      expect(await dispatchWorkflowOutboundMessage(intent.id)).toEqual({ status: 'disabled' })
      expect(fetchSpy).not.toHaveBeenCalled()
      const stored = await db.workflowOutboundMessage.findUnique({ where: { id: intent.id } })
      expect(stored).toMatchObject({ status: 'queued', attemptCount: 0, claimToken: null })
    } finally {
      if (previousFlag === undefined) delete process.env.CHANNEL_AUTOREPLY_ENABLED
      else process.env.CHANNEL_AUTOREPLY_ENABLED = previousFlag
      if (!existingIntegration) await db.integration.deleteMany({ where: { organizationId: FIX.orgA.id } })
    }
  })

})

describe('workflow outbound outbox dispatcher', () => {
  it('dispatches a claimed Baileys intent and persists provider confirmation', async () => {
    process.env.WHATSAPP_DAEMON_URL = 'http://daemon.test'
    process.env.INTERNAL_API_SECRET = testDaemonSecret
    const run = await createRun('Workflow outbox dispatcher success')
    const intent = await enqueueWorkflowOutboundMessage({
      organizationId: FIX.orgA.id, ...run, stepIndex: 0, channel: 'whatsapp',
      payload: { to: '573001234567', text: 'mensaje simulado' },
    })
    outboundIds.push(intent.id)
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, messageId: 'baileys-provider-id' }), { status: 200 }))
    const result = await dispatchWorkflowOutboundMessage(intent.id)
    expect(result.status).toBe('sent')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const request = fetchSpy.mock.calls[0][1]
    expect(JSON.parse(String(request?.body))).toMatchObject({ orgId: FIX.orgA.id, to: '573001234567', text: 'mensaje simulado' })
    const stored = await db.workflowOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored).toMatchObject({ status: 'sent', providerMessageId: 'baileys-provider-id', attemptCount: 1 })
  })

  it('quarantines an ambiguous transport result and never retries it', async () => {
    process.env.WHATSAPP_DAEMON_URL = 'http://daemon.test'
    process.env.INTERNAL_API_SECRET = testDaemonSecret
    const run = await createRun('Workflow outbox dispatcher timeout')
    const intent = await enqueueWorkflowOutboundMessage({
      organizationId: FIX.orgA.id, ...run, stepIndex: 0, channel: 'whatsapp',
      payload: { to: '573001234567', text: 'resultado incierto' },
    })
    outboundIds.push(intent.id)
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('simulated timeout'))
    expect((await dispatchWorkflowOutboundMessage(intent.id)).status).toBe('unknown')
    expect((await dispatchWorkflowOutboundMessage(intent.id)).status).toBe('not_claimed')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const stored = await db.workflowOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('unknown')
    expect(stored?.providerErrorCode).toBe('PROVIDER_RESULT_UNCERTAIN')
  })

  it('does not report sent when a stale lease was quarantined before provider acknowledgement', async () => {
    process.env.WHATSAPP_DAEMON_URL = 'http://daemon.test'
    process.env.INTERNAL_API_SECRET = testDaemonSecret
    const run = await createRun('Workflow outbox stale lease')
    const intent = await enqueueWorkflowOutboundMessage({
      organizationId: FIX.orgA.id, ...run, stepIndex: 0, channel: 'whatsapp',
      payload: { to: '573001234567', text: 'lease de prueba' },
    })
    outboundIds.push(intent.id)
    let resolveFetch!: (response: Response) => void
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const dispatch = dispatchWorkflowOutboundMessage(intent.id)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    await db.workflowOutboundMessage.update({ where: { id: intent.id }, data: { startedAt: new Date(Date.now() - 6 * 60_000) } })
    await quarantineStaleWorkflowOutboundMessages()
    resolveFetch(new Response(JSON.stringify({ success: true, messageId: 'late-provider-ack' }), { status: 200 }))
    expect(await dispatch).toEqual({ status: 'unknown' })
    const stored = await db.workflowOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('unknown')
    expect(stored?.providerMessageId).toBeNull()
  })

  it('rejects an outbox intent that references another organization run', async () => {
    const automation = await db.automation.create({
      data: { organizationId: FIX.orgB.id, name: 'Foreign workflow outbox test', triggerType: 'manual', isActive: true, actions: '[]' },
    })
    const run = await db.automationRun.create({
      data: { organizationId: FIX.orgB.id, automationId: automation.id, status: 'running' },
    })
    pairs.push({ automationId: automation.id, runId: run.id })
    await expect(enqueueWorkflowOutboundMessage({
      organizationId: FIX.orgA.id, automationId: automation.id, automationRunId: run.id,
      stepIndex: 0, channel: 'whatsapp', payload: { to: '573001234567', text: 'no debe persistir' },
    })).rejects.toThrow('WORKFLOW_OUTBOX_RUN_TENANT_MISMATCH')
    expect(await db.workflowOutboundMessage.count({ where: { automationRunId: run.id } })).toBe(0)
  })
  it('allows only one concurrent worker to claim and send the same intent', async () => {
    process.env.WHATSAPP_DAEMON_URL = 'http://daemon.test'
    process.env.INTERNAL_API_SECRET = testDaemonSecret
    const run = await createRun('Workflow outbox concurrent claim')
    const intent = await enqueueWorkflowOutboundMessage({
      organizationId: FIX.orgA.id, ...run, stepIndex: 0, channel: 'whatsapp',
      payload: { to: '573001234567', text: 'un solo despacho' },
    })
    outboundIds.push(intent.id)
    let resolveFetch!: (response: Response) => void
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const first = dispatchWorkflowOutboundMessage(intent.id)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const second = await dispatchWorkflowOutboundMessage(intent.id)
    expect(second).toEqual({ status: 'not_claimed' })
    resolveFetch(new Response(JSON.stringify({ success: true, messageId: 'single-provider-id' }), { status: 200 }))
    expect(await first).toEqual({ status: 'sent' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const stored = await db.workflowOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored).toMatchObject({ status: 'sent', providerMessageId: 'single-provider-id', attemptCount: 1 })
  })

})
