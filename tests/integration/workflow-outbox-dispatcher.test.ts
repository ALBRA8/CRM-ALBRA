import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { enqueueWorkflowOutboundMessage, dispatchWorkflowOutboundMessage } from '@/lib/workflow-outbox'
import { FIX } from '../setup/seed-data'

const ids: string[] = []
const previousDaemonUrl = process.env.WHATSAPP_DAEMON_URL
const previousInternalSecret = process.env.INTERNAL_API_SECRET
const testDaemonSecret = ['test', 'internal', 'secret', '0123456789'].join('-')

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousDaemonUrl === undefined) delete process.env.WHATSAPP_DAEMON_URL
  else process.env.WHATSAPP_DAEMON_URL = previousDaemonUrl
  if (previousInternalSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousInternalSecret
  if (ids.length) {
    await db.workflowOutboundMessage.deleteMany({ where: { id: { in: ids } } })
    ids.length = 0
  }
})

describe('workflow outbound outbox dispatcher', () => {
  it('dispatches a claimed Baileys intent and persists provider confirmation', async () => {
    process.env.WHATSAPP_DAEMON_URL = 'http://daemon.test'
    process.env.INTERNAL_API_SECRET = testDaemonSecret
    const intent = await enqueueWorkflowOutboundMessage({ organizationId: FIX.orgA.id, automationId: 'automation-outbox-test', automationRunId: 'run-outbox-dispatch-success', stepIndex: 0, channel: 'whatsapp', payload: { to: '573001234567', text: 'mensaje simulado' } })
    ids.push(intent.id)
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
    const intent = await enqueueWorkflowOutboundMessage({ organizationId: FIX.orgA.id, automationId: 'automation-outbox-test', automationRunId: 'run-outbox-dispatch-unknown', stepIndex: 0, channel: 'whatsapp', payload: { to: '573001234567', text: 'resultado incierto' } })
    ids.push(intent.id)
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('simulated timeout'))
    expect((await dispatchWorkflowOutboundMessage(intent.id)).status).toBe('unknown')
    expect((await dispatchWorkflowOutboundMessage(intent.id)).status).toBe('not_claimed')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const stored = await db.workflowOutboundMessage.findUnique({ where: { id: intent.id } })
    expect(stored?.status).toBe('unknown')
    expect(stored?.providerErrorCode).toBe('PROVIDER_RESULT_UNCERTAIN')
  })
})
