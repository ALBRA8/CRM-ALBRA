import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { json } from '@/lib/api-helpers'
import { safeEqual } from '@/lib/internal-org-auth'
import { dispatchWorkflowOutboundMessage, quarantineStaleWorkflowOutboundMessages } from '@/lib/workflow-outbox'

export const runtime = 'nodejs'

function isAuthorized(req: NextRequest) {
  const expected = process.env.WORKFLOW_OUTBOX_WORKER_SECRET
  const authorization = req.headers.get('authorization') || ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  return !!expected && expected.length >= 32 && !!supplied && safeEqual(supplied, expected)
}

/** Aggregate health only; never exposes tenant IDs, recipients, message bodies or intent IDs. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return json({ error: 'No autorizado' }, { status: 401 })
  const [queued, sending, sent, failed, unknown, oldest] = await Promise.all([
    db.workflowOutboundMessage.count({ where: { status: 'queued' } }),
    db.workflowOutboundMessage.count({ where: { status: 'sending' } }),
    db.workflowOutboundMessage.count({ where: { status: 'sent' } }),
    db.workflowOutboundMessage.count({ where: { status: 'failed' } }),
    db.workflowOutboundMessage.count({ where: { status: 'unknown' } }),
    db.workflowOutboundMessage.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ])
  return json({
    workerEnabled: process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED === 'true',
    outbox: { queued, sending, sent, failed, unknown, oldestQueuedAgeSeconds: oldest ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000)) : 0 },
    sampledAt: new Date().toISOString(),
  })
}

/** Pull worker. Explicit opt-in required; unknown/stale sends are never retried. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return json({ error: 'No autorizado' }, { status: 401 })
  if (process.env.WORKFLOW_OUTBOX_DISPATCH_ENABLED !== 'true') {
    return json({ error: 'El despacho de workflows está deshabilitado por configuración' }, { status: 503 })
  }
  const body = await req.json().catch(() => ({})) as { limit?: number }
  const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(Number(body.limit), 5)) : 1
  const quarantined = await quarantineStaleWorkflowOutboundMessages()

  // Disabled auto-replies remain queued by design. Page through them without
  // letting the oldest paused Telegram intents consume this invocation's
  // dispatch limit and starve eligible WhatsApp, email, or workflow messages.
  const results: Array<{ status: string }> = []
  let cursor: string | undefined
  let scanned = 0
  const pageSize = 50
  while (results.length < limit) {
    const page = await db.workflowOutboundMessage.findMany({
      where: { status: 'queued' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    })
    if (!page.length) break
    for (const item of page) {
      cursor = item.id
      scanned += 1
      const result = await dispatchWorkflowOutboundMessage(item.id)
      if (result.status !== 'disabled') results.push(result)
      if (results.length >= limit) break
    }
    if (page.length < pageSize) break
  }
  return json({
    processed: results.length,
    scanned,
    quarantinedStale: quarantined.count,
    results,
    note: 'Los estados unknown requieren conciliación humana y nunca se reintentan automáticamente.',
  })
}
