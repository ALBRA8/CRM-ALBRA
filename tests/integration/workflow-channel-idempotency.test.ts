import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { FIX } from '../setup/seed-data'
import { decryptSecret } from '@/lib/crypto'
import { enqueueWorkflowOutboundMessage } from '@/lib/workflow-outbox'

vi.mock('@/lib/workflow-engine', async (importOriginal) => (await importOriginal<typeof import('@/lib/workflow-engine')>()) as typeof import('@/lib/workflow-engine'))

const automationIds: string[] = []
const notificationIds: string[] = []
const previousExternalSendFlag = process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousExternalSendFlag === undefined) delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
  else process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED = previousExternalSendFlag
  if (notificationIds.length) {
    await db.notification.deleteMany({ where: { id: { in: notificationIds } } })
    notificationIds.length = 0
  }
  if (automationIds.length) {
    await db.workflowOutboundMessage.deleteMany({ where: { automationId: { in: automationIds } } })
    await db.automationRun.deleteMany({ where: { automationId: { in: automationIds } } })
    await db.automation.deleteMany({ where: { id: { in: automationIds } } })
    automationIds.length = 0
  }
})

describe('workflow trigger idempotency for channel messages', () => {
  it('deduplicates a redelivered WhatsApp/Instagram message by provider message id', async () => {
    const automation = await db.automation.create({
      data: {
        organizationId: FIX.orgA.id,
        name: 'Webhook idempotency test',
        triggerType: 'message_received',
        isActive: true,
        actions: '[]',
      },
    })
    automationIds.push(automation.id)

    const event = {
      orgId: FIX.orgA.id,
      type: 'message_received' as const,
      payload: {
        channel: 'whatsapp',
        messageId: 'wamid.workflow-idempotency-test',
        from: '+573001234567',
        text: 'mensaje de prueba',
        conversationId: '+573001234567',
        clientId: FIX.clientA1.id,
      },
    }

    const first = await runWorkflowsForTrigger(event)
    const replay = await runWorkflowsForTrigger(event)

    expect(first).toHaveLength(1)
    expect(first[0].status).toBe('success')
    expect(replay).toHaveLength(1)
    expect(replay[0].status).toBe('deduplicated')

    const runs = await db.automationRun.findMany({ where: { automationId: automation.id } })
    expect(runs).toHaveLength(1)
    expect(runs[0].idempotencyKey).toBe('message_received:wamid.workflow-idempotency-test')
  })
  it('persists workflow sends in the encrypted durable outbox even when the legacy send flag is requested', async () => {
    process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED = 'true'
    const fetchSpy = vi.spyOn(global, 'fetch')
    const automation = await db.automation.create({
      data: {
        organizationId: FIX.orgA.id,
        name: 'External send safety test',
        triggerType: 'message_received',
        isActive: true,
        actions: JSON.stringify([{ type: 'send_whatsapp', config: { body: 'No enviar en pruebas' } }]),
      },
    })
    automationIds.push(automation.id)

    await runWorkflowsForTrigger({
      orgId: FIX.orgA.id,
      type: 'message_received',
      payload: {
        messageId: 'wamid.external-send-safety-test',
        clientId: FIX.clientA1.id,
        phone: FIX.clientA1.phone,
      },
    })

    const notification = await db.notification.findFirst({
      where: {
        organizationId: FIX.orgA.id,
        title: 'Mensaje whatsapp en cola durable',
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(notification).not.toBeNull()
    if (notification) notificationIds.push(notification.id)
    expect(notification?.data).toContain('"status":"queued"')
    const outbound = await db.workflowOutboundMessage.findFirst({ where: { organizationId: FIX.orgA.id, automationId: automation.id } })
    expect(outbound).not.toBeNull()
    expect(outbound?.status).toBe('queued')
    expect(outbound?.payloadEnc).toMatch(/^v1:/)
    expect(outbound?.payloadEnc).not.toContain(FIX.clientA1.phone || 'never-match')
    expect(decryptSecret(outbound?.payloadEnc)).toContain(FIX.clientA1.phone || '')
    const run = await db.automationRun.findFirst({ where: { automationId: automation.id } })
    expect(run).not.toBeNull()
    const states = JSON.parse(run?.stepStates || '[]') as Array<{ status: string }>
    expect(states[0]?.status).toBe('success')
    const duplicate = await enqueueWorkflowOutboundMessage({
      organizationId: FIX.orgA.id,
      automationId: automation.id,
      automationRunId: run!.id,
      stepIndex: 0,
      channel: 'whatsapp',
      payload: { to: FIX.clientA1.phone || '', text: 'No enviar en pruebas' },
    })
    expect(duplicate.id).toBe(outbound?.id)
    await expect(enqueueWorkflowOutboundMessage({
      organizationId: FIX.orgA.id,
      automationId: automation.id,
      automationRunId: run!.id,
      stepIndex: 0,
      channel: 'whatsapp',
      payload: { to: FIX.clientA1.phone || '', text: 'contenido diferente' },
    })).rejects.toThrow('WORKFLOW_OUTBOX_IDEMPOTENCY_CONFLICT')
    expect(await db.workflowOutboundMessage.count({ where: { automationId: automation.id } })).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

})
