import { pathToFileURL } from 'node:url'

const TIMEOUT_MS = 10_000

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0
}

export function evaluateOutboxHealth(channel, workflow) {
  const alerts = []
  const add = (severity, code, message) => alerts.push({ severity, code, message })

  if (!isRecord(channel) || !isRecord(channel.outbox) || !isRecord(channel.webhookEvents)) {
    throw new Error('CHANNEL_HEALTH_SCHEMA_INVALID')
  }
  if (!isRecord(workflow) || !isRecord(workflow.outbox)) {
    throw new Error('WORKFLOW_HEALTH_SCHEMA_INVALID')
  }

  const channelCounts = ['queued', 'sending', 'sent', 'failed', 'unknown', 'staleSending', 'oldestQueuedAgeSeconds']
  const webhookCounts = ['processing', 'failed', 'staleProcessing']
  const workflowCounts = ['queued', 'sending', 'sent', 'failed', 'unknown', 'oldestQueuedAgeSeconds']
  for (const key of channelCounts) if (!nonNegativeNumber(channel.outbox[key])) throw new Error('CHANNEL_HEALTH_SCHEMA_INVALID')
  for (const key of webhookCounts) if (!nonNegativeNumber(channel.webhookEvents[key])) throw new Error('CHANNEL_HEALTH_SCHEMA_INVALID')
  for (const key of workflowCounts) if (!nonNegativeNumber(workflow.outbox[key])) throw new Error('WORKFLOW_HEALTH_SCHEMA_INVALID')

  if (channel.outbox.staleSending > 0) add('critical', 'CHANNEL_STALE_SENDING', 'Hay envíos de canales atascados en sending.')
  if (channel.outbox.unknown > 0) add('high', 'CHANNEL_OUTBOX_UNKNOWN', 'Hay intenciones de canales con resultado desconocido; requieren conciliación humana.')
  if (channel.webhookEvents.failed > 0) add('high', 'WEBHOOK_EVENTS_FAILED', 'Hay eventos webhook fallidos.')
  if (channel.webhookEvents.staleProcessing > 0) add('high', 'WEBHOOK_EVENTS_STALE', 'Hay eventos webhook con procesamiento vencido.')
  if (channel.outbox.oldestQueuedAgeSeconds > 600) add('medium', 'CHANNEL_QUEUE_OLD', 'La intención más antigua de canales lleva más de 10 minutos en cola.')
  if (workflow.outbox.unknown > 0) add('high', 'WORKFLOW_OUTBOX_UNKNOWN', 'Hay intenciones workflow con resultado desconocido; requieren conciliación humana.')
  if (workflow.outbox.failed > 0) add('high', 'WORKFLOW_OUTBOX_FAILED', 'Hay intenciones workflow fallidas.')
  if (workflow.outbox.oldestQueuedAgeSeconds > 600) add('medium', 'WORKFLOW_QUEUE_OLD', 'La intención workflow más antigua lleva más de 10 minutos en cola.')

  return alerts
}

function requiredHttpsUrl(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(name + '_INVALID')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(name + '_MUST_BE_HTTPS')
  }
  return url
}

async function getHealth(url, secret, name, fetchImpl) {
  if (!secret || secret.length < 32) throw new Error(name + '_SECRET_MISSING_OR_WEAK')
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { authorization: 'Bearer ' + secret, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(name + '_HTTP_' + response.status)
  const data = await response.json()
  if (!isRecord(data)) throw new Error(name + '_INVALID_JSON')
  return data
}

export async function runOutboxMonitor(env = process.env, fetchImpl = fetch) {
  const base = requiredHttpsUrl(env.OUTBOX_MONITOR_BASE_URL || '', 'OUTBOX_MONITOR_BASE_URL')
  const channelSecret = env.CHANNEL_OUTBOX_WORKER_SECRET || ''
  const workflowSecret = env.WORKFLOW_OUTBOX_WORKER_SECRET || ''
  const channelUrl = new URL('/api/internal/channel-outbox', base)
  const workflowUrl = new URL('/api/internal/workflow-outbox', base)

  const [channel, workflow] = await Promise.all([
    getHealth(channelUrl, channelSecret, 'CHANNEL_OUTBOX', fetchImpl),
    getHealth(workflowUrl, workflowSecret, 'WORKFLOW_OUTBOX', fetchImpl),
  ])
  const alerts = evaluateOutboxHealth(channel, workflow)
  const report = { sampledAt: new Date().toISOString(), alerts }

  if (alerts.length > 0) {
    const webhook = requiredHttpsUrl(env.OUTBOX_ALERT_WEBHOOK_URL || '', 'OUTBOX_ALERT_WEBHOOK_URL')
    const response = await fetchImpl(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'CRM-ALBRA: alertas de outbox', ...report }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
    if (!response.ok) throw new Error('ALERT_WEBHOOK_HTTP_' + response.status)
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOutboxMonitor()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2))
      if (report.alerts.length > 0) process.exitCode = 2
    })
    .catch((error) => {
      console.error('[outbox-monitor] ' + (error instanceof Error ? error.message : 'MONITOR_FAILED'))
      process.exitCode = 1
    })
}
