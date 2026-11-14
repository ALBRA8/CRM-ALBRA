import { describe, expect, it } from 'vitest'
import { evaluateOutboxHealth } from '../../scripts/monitor-outbox.mjs'

const healthyChannel = {
  outbox: { queued: 0, sending: 0, sent: 4, failed: 0, unknown: 0, staleSending: 0, oldestQueuedAgeSeconds: 0 },
  webhookEvents: { processing: 0, failed: 0, staleProcessing: 0 },
}
const healthyWorkflow = {
  outbox: { queued: 0, sending: 0, sent: 2, failed: 0, unknown: 0, oldestQueuedAgeSeconds: 0 },
}

describe('monitor de outbox', () => {
  it('no genera alertas cuando ambas colas están sanas', () => {
    expect(evaluateOutboxHealth(healthyChannel, healthyWorkflow)).toEqual([])
  })

  it('clasifica leases vencidos como críticos y unknown como alta prioridad', () => {
    const channel = {
      ...healthyChannel,
      outbox: { ...healthyChannel.outbox, staleSending: 1, unknown: 2 },
    }
    const alerts = evaluateOutboxHealth(channel, healthyWorkflow)
    expect(alerts.map((alert) => [alert.severity, alert.code])).toEqual([
      ['critical', 'CHANNEL_STALE_SENDING'],
      ['high', 'CHANNEL_OUTBOX_UNKNOWN'],
    ])
  })

  it('alerta por webhook fallido o vencido y por cola antigua', () => {
    const channel = {
      ...healthyChannel,
      outbox: { ...healthyChannel.outbox, oldestQueuedAgeSeconds: 601 },
      webhookEvents: { processing: 1, failed: 1, staleProcessing: 1 },
    }
    const alerts = evaluateOutboxHealth(channel, healthyWorkflow)
    expect(alerts.map((alert) => alert.code)).toEqual([
      'WEBHOOK_EVENTS_FAILED',
      'WEBHOOK_EVENTS_STALE',
      'CHANNEL_QUEUE_OLD',
    ])
  })

  it('detecta unknown, fallos y cola antigua en workflow outbox', () => {
    const workflow = {
      outbox: { ...healthyWorkflow.outbox, failed: 1, unknown: 1, oldestQueuedAgeSeconds: 900 },
    }
    const alerts = evaluateOutboxHealth(healthyChannel, workflow)
    expect(alerts.map((alert) => alert.code)).toEqual([
      'WORKFLOW_OUTBOX_UNKNOWN',
      'WORKFLOW_OUTBOX_FAILED',
      'WORKFLOW_QUEUE_OLD',
    ])
  })

  it('rechaza snapshots incompletos en lugar de reportar falso estado sano', () => {
    expect(() => evaluateOutboxHealth({}, healthyWorkflow)).toThrow('CHANNEL_HEALTH_SCHEMA_INVALID')
  })
})
