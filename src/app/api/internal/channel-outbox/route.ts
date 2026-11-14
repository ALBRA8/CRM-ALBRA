import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import { safeEqual } from '@/lib/internal-org-auth'
import { dispatchChannelOutboundMessage, type DispatchResult } from '@/lib/channel-outbound-dispatcher'
import { createMetaChannelAdapters } from '@/lib/meta-channel-adapters'

export const runtime = 'nodejs'

/**
 * POST /api/internal/channel-outbox
 * Worker pull endpoint. No scheduler is registered by this route.
 * Requires a dedicated secret and an explicit feature flag before it can send.
 */

function isAuthorized(req: NextRequest) {
  const expected = process.env.CHANNEL_OUTBOX_WORKER_SECRET
  const authorization = req.headers.get('authorization') || ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  return !!expected && expected.length >= 32 && !!supplied && safeEqual(supplied, expected)
}

/**
 * GET /api/internal/channel-outbox
 * Read-only aggregate health snapshot. Never returns message bodies, IDs,
 * connection names, tenant IDs or credentials.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return json({ error: 'No autorizado' }, { status: 401 })

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000)
  const [queued, oldestQueued, sending, sent, failed, unknown, staleSending, webhookProcessing, webhookFailed, staleWebhookEvents, connectedMeta] = await Promise.all([
    db.channelOutboundMessage.count({ where: { status: 'queued' } }),
    db.channelOutboundMessage.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.channelOutboundMessage.count({ where: { status: 'sending' } }),
    db.channelOutboundMessage.count({ where: { status: 'sent' } }),
    db.channelOutboundMessage.count({ where: { status: 'failed' } }),
    db.channelOutboundMessage.count({ where: { status: 'unknown' } }),
    db.channelOutboundMessage.count({ where: { status: 'sending', startedAt: { lt: staleBefore } } }),
    db.channelWebhookEvent.count({ where: { status: 'processing' } }),
    db.channelWebhookEvent.count({ where: { status: 'failed' } }),
    db.channelWebhookEvent.count({ where: { status: 'processing', updatedAt: { lt: staleBefore } } }),
    db.channelConnection.count({
      where: { status: 'connected', channel: { in: ['whatsapp', 'instagram', 'messenger'] }, provider: { in: ['meta_cloud', 'meta_graph'] } },
    }),
  ])

  return json({
    workerEnabled: process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED === 'true',
    autoReplyEnabled: process.env.CHANNEL_AUTOREPLY_ENABLED === 'true',
    workflowExternalSendsEnabled: process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED === 'true',
    workflowExternalSendsFlagRequested: process.env.WORKFLOW_EXTERNAL_SENDS_ENABLED === 'true',
    workflowOutboxWorkerSecretConfigured: !!process.env.WORKFLOW_OUTBOX_WORKER_SECRET,
    whatspowerBridgeEnabled: process.env.WHATSPOWER_ENABLED === 'true',
    outbox: { queued, oldestQueuedAgeSeconds: oldestQueued ? Math.max(0, Math.floor((Date.now() - oldestQueued.createdAt.getTime()) / 1000)) : 0, sending, sent, failed, unknown, staleSending },
    webhookEvents: { processing: webhookProcessing, failed: webhookFailed, staleProcessing: staleWebhookEvents },
    connectedMetaConnections: connectedMeta,
    sampledAt: new Date().toISOString(),
  })
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return json({ error: 'No autorizado' }, { status: 401 })
  }
  if (process.env.CHANNEL_OUTBOUND_DISPATCH_ENABLED !== 'true') {
    return json({ error: 'El despacho de mensajes está deshabilitado por configuración' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({})) as { limit?: number }
  const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(Number(body.limit), 5)) : 1
  const queued = await db.channelOutboundMessage.findMany({
    where: {
      status: 'queued',
      conversation: {
        is: {
          status: 'active',
          connection: {
            is: { status: 'connected', channel: { in: ['whatsapp', 'instagram', 'messenger'] }, provider: { in: ['meta_cloud', 'meta_graph'] } },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  const adapters = createMetaChannelAdapters()
  const results: Array<{ id: string } & DispatchResult> = []
  for (const item of queued) {
    results.push({
      id: item.id,
      ...(await dispatchChannelOutboundMessage(item.id, adapters)),
    })
  }

  return json({
    processed: results.length,
    results,
    note: 'Los estados unknown requieren conciliación manual; nunca se reintentan automáticamente.',
  })
}
