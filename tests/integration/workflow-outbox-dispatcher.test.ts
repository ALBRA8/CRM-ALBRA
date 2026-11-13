import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { enqueueWorkflowOutboundMessage, dispatchWorkflowOutboundMessage } from '@/lib/workflow-outbox'
import { FIX } from '../setup/seed-data'

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
  return { automationId: automation.id, runId: run.id }
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
})
