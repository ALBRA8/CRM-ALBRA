import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { FIX } from '../setup/seed-data'

const automationIds: string[] = []
const previousExternalSendFlag = process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED

afterEach(async () => {
  if (previousExternalSendFlag === undefined) delete process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED
  else process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED = previousExternalSendFlag
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
})
