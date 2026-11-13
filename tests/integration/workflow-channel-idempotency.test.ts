import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { FIX } from '../setup/seed-data'

vi.mock('@/lib/workflow-engine', async (importOriginal) => (await importOriginal<typeof import('@/lib/workflow-engine')>()) as typeof import('@/lib/workflow-engine'))

const automationIds: string[] = []
const notificationIds: string[] = []
const previousExternalSendFlag = process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED

afterEach(async () => {
  if (previousExternalSendFlag === undefined) delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
  else process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED = previousExternalSendFlag
  if (notificationIds.length) {
    await db.notification.deleteMany({ where: { id: { in: notificationIds } } })
    notificationIds.length = 0
  }
  if (automationIds.length) {
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
  it('does not perform workflow channel sends unless explicitly enabled', async () => {
    delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
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
        title: 'Mensaje whatsapp PENDIENTE de envío (fallo de canal)',
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(notification).not.toBeNull()
    if (notification) notificationIds.push(notification.id)
    expect(notification?.data).toContain('"sent":false')
    expect(notification?.data).toContain('WORKFLOW_EXTERNAL_SENDS_ENABLED')
  })

})
