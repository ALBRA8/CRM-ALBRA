import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { getIntegration, parseTelegramState, sendTelegramBotMessage } from '@/lib/integrations'
import { getSmtpConfig, trySendSmtp } from '@/lib/mail'

export type WorkflowOutboundChannel = 'whatsapp' | 'telegram' | 'email'
export type WorkflowOutboundPayload =
  | { to: string; text: string }
  | { chatId: string | number; text: string }
  | { to: string; subject: string; html: string; text?: string }

const SAFE_ERROR = /^[A-Z0-9_.-]{1,64}$/

/** Persist encrypted recipient/content before the workflow step can finish. */
export async function enqueueWorkflowOutboundMessage(input: { organizationId: string; automationId: string; automationRunId: string; stepIndex: number; channel: WorkflowOutboundChannel; payload: WorkflowOutboundPayload }) {
  if (!input.organizationId || !input.automationRunId || !Number.isInteger(input.stepIndex) || input.stepIndex < 0) throw new Error('WORKFLOW_OUTBOX_INVALID_INPUT')
  const validRun = await db.automationRun.findFirst({ where: { id: input.automationRunId, organizationId: input.organizationId, automationId: input.automationId }, select: { id: true } })
  if (!validRun) throw new Error('WORKFLOW_OUTBOX_RUN_TENANT_MISMATCH')
  const plain = JSON.stringify(input.payload)
  const payloadEnc = encryptSecret(plain)
  if (!payloadEnc) throw new Error('WORKFLOW_OUTBOX_ENCRYPTION_UNAVAILABLE')
  const idempotencyKey = 'workflow:' + input.automationRunId + ':' + input.stepIndex
  try {
    return await db.workflowOutboundMessage.create({ data: { organizationId: input.organizationId, automationId: input.automationId, automationRunId: input.automationRunId, stepIndex: input.stepIndex, idempotencyKey, channel: input.channel, payloadEnc } })
  } catch (error) {
    const existing = await db.workflowOutboundMessage.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } } })
    if (!existing) throw error
    if (existing.channel !== input.channel || decryptSecret(existing.payloadEnc) !== plain) throw new Error('WORKFLOW_OUTBOX_IDEMPOTENCY_CONFLICT')
    return existing
  }
}

async function finishWorkflowOutboundMessage(id: string, claimToken: string, status: 'sent' | 'failed' | 'unknown', errorCode?: string, providerMessageId?: string) {
  return db.workflowOutboundMessage.updateMany({
    where: { id, status: 'sending', claimToken },
    data: { status, providerErrorCode: errorCode && SAFE_ERROR.test(errorCode) ? errorCode : errorCode ? 'PROVIDER_ERROR' : null, providerMessageId: providerMessageId || null, sentAt: status === 'sent' ? new Date() : null, finishedAt: new Date(), claimToken: null },
  })
}

async function claimWorkflowOutboundMessage(id: string) {
  const claimToken = randomUUID()
  const result = await db.workflowOutboundMessage.updateMany({ where: { id, status: 'queued' }, data: { status: 'sending', claimToken, attemptCount: { increment: 1 }, startedAt: new Date(), providerErrorCode: null } })
  if (result.count !== 1) return null
  const item = await db.workflowOutboundMessage.findFirst({ where: { id, status: 'sending', claimToken } })
  if (!item) return null
  const raw = decryptSecret(item.payloadEnc)
  if (!raw) { await finishWorkflowOutboundMessage(item.id, claimToken, 'failed', 'PAYLOAD_DECRYPT_FAILED'); return null }
  try { return { item, claimToken, payload: JSON.parse(raw) as Record<string, unknown> } }
  catch { await finishWorkflowOutboundMessage(item.id, claimToken, 'failed', 'PAYLOAD_INVALID'); return null }
}

/** Dispatch one persisted intent. Uncertain results are terminal and never retried. */
export async function dispatchWorkflowOutboundMessage(id: string) {
  const claimed = await claimWorkflowOutboundMessage(id)
  if (!claimed) return { status: 'not_claimed' as const }
  const { item, claimToken, payload } = claimed
  try {
    if (item.channel === 'whatsapp') {
      const to = typeof payload.to === 'string' ? payload.to : ''
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (!to || !text) { await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'RECIPIENT_OR_BODY_MISSING'); return { status: 'failed' as const } }
      const secret = process.env.INTERNAL_API_SECRET
      if (!secret || secret.length < 24) { await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'DAEMON_AUTH_NOT_CONFIGURED'); return { status: 'failed' as const } }
      const base = (process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002').replace(/\/+$/, '')
      const response = await fetch(base + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify({ orgId: item.organizationId, to, text }), signal: AbortSignal.timeout(12_000) })
      const data = await response.json().catch(() => ({})) as { success?: boolean; messageId?: string }
      if (response.ok && data.success && data.messageId) { await finishWorkflowOutboundMessage(id, claimToken, 'sent', undefined, data.messageId); return { status: 'sent' as const } }
      if (response.status >= 400 && response.status < 500) { await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'DAEMON_HTTP_' + response.status); return { status: 'failed' as const } }
      await finishWorkflowOutboundMessage(id, claimToken, 'unknown', 'DAEMON_RESULT_UNCERTAIN'); return { status: 'unknown' as const }
    }
    if (item.channel === 'telegram') {
      const chatId = payload.chatId
      const text = typeof payload.text === 'string' ? payload.text : ''
      if ((typeof chatId !== 'string' && typeof chatId !== 'number') || !text) { await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'RECIPIENT_OR_BODY_MISSING'); return { status: 'failed' as const } }
      const integration = await getIntegration(item.organizationId)
      const token = parseTelegramState(integration.telegramBotTokenEnc).token
      if (!token) { await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'TELEGRAM_NOT_CONFIGURED'); return { status: 'failed' as const } }
      const result = await sendTelegramBotMessage({ token, chatId, text })
      if (result.ok) { await finishWorkflowOutboundMessage(id, claimToken, 'sent'); return { status: 'sent' as const } }
      await finishWorkflowOutboundMessage(id, claimToken, 'unknown', 'TELEGRAM_RESULT_UNCERTAIN'); return { status: 'unknown' as const }
    }
    if (item.channel === 'email') {
      const to = typeof payload.to === 'string' ? payload.to : ''
      const subject = typeof payload.subject === 'string' ? payload.subject : ''
      const html = typeof payload.html === 'string' ? payload.html : ''
      const text = typeof payload.text === 'string' ? payload.text : undefined
      if (!to || !subject || !html || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'EMAIL_PAYLOAD_INVALID'); return { status: 'failed' as const } }
      const config = await getSmtpConfig(item.organizationId)
      if (!config) { await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'SMTP_NOT_CONFIGURED'); return { status: 'failed' as const } }
      const result = await trySendSmtp(config, to, subject, html, text)
      if (result.ok) { await finishWorkflowOutboundMessage(id, claimToken, 'sent', undefined, result.messageId); return { status: 'sent' as const } }
      await finishWorkflowOutboundMessage(id, claimToken, 'unknown', 'SMTP_RESULT_UNCERTAIN'); return { status: 'unknown' as const }
    }
    await finishWorkflowOutboundMessage(id, claimToken, 'failed', 'CHANNEL_UNSUPPORTED')
    return { status: 'failed' as const }
  } catch {
    await finishWorkflowOutboundMessage(id, claimToken, 'unknown', 'PROVIDER_RESULT_UNCERTAIN')
    return { status: 'unknown' as const }
  }
}

/** Crashed sends are quarantined; they are never put back in the queue. */
export async function quarantineStaleWorkflowOutboundMessages(olderThanMs = 5 * 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs)
  return db.workflowOutboundMessage.updateMany({ where: { status: 'sending', startedAt: { lt: cutoff } }, data: { status: 'unknown', providerErrorCode: 'WORKER_LEASE_EXPIRED', finishedAt: new Date(), claimToken: null } })
}