import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { ChannelOutboundError, createChannelOutboundIntent } from '@/lib/channel-outbox'

/**
 * POST /api/tiktok/send
 * Compatibility endpoint that now queues a canonical outbox intent.
 * It never sends directly; the guarded internal worker performs delivery.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const body = await req.json().catch(() => ({})) as {
      conversationId?: string
      clientRequestId?: string
      text?: string
    }
    requireFields(body as unknown as Record<string, unknown>, ['conversationId', 'clientRequestId', 'text'])

    const conversation = await db.channelConversation.findFirst({
      where: {
        id: String(body.conversationId),
        organizationId: auth.orgId,
        channel: 'tiktok',
        connection: { is: { organizationId: auth.orgId, channel: 'tiktok', provider: 'tiktok_business' } },
      },
      select: { id: true },
    })
    if (!conversation) return json({ error: 'Conversación TikTok no encontrada', code: 'NOT_FOUND' }, { status: 404 })

    try {
      const intent = await createChannelOutboundIntent({
        organizationId: auth.orgId,
        conversationId: conversation.id,
        clientRequestId: String(body.clientRequestId),
        body: String(body.text || ''),
        requestedByUserId: auth.userId,
      })
      return json({
        success: true,
        queued: true,
        sent: false,
        outboundId: intent.id,
        status: intent.status,
        clientRequestId: intent.clientRequestId,
      }, { status: 202 })
    } catch (error) {
      if (error instanceof ChannelOutboundError) {
        const status = error.code === 'NOT_FOUND' ? 404
          : error.code === 'NOT_SENDABLE' || error.code === 'IDEMPOTENCY_CONFLICT' ? 409
          : 400
        return json({ error: error.message, code: error.code }, { status })
      }
      throw error
    }
  })
}
