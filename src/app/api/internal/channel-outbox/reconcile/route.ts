import type { NextRequest } from 'next/server'
import { json } from '@/lib/api-helpers'
import { safeEqual } from '@/lib/internal-org-auth'
import { reconcileUnknownChannelOutboundMessage } from '@/lib/channel-outbox'

export const runtime = 'nodejs'

/**
 * POST /api/internal/channel-outbox/reconcile
 * Reconciliation is an operator action after checking the provider, never a retry.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.CHANNEL_OUTBOX_WORKER_SECRET
  const authHeader = req.headers.get('authorization') || ''
  const supplied = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!expected || expected.length < 32 || !supplied || !safeEqual(supplied, expected)) {
    return json({ error: 'No autorizado' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    id?: string
    resolution?: string
    providerChecked?: boolean
    providerMessageId?: string
  }
  if (!body.id || body.id.length > 128 || !['sent', 'failed'].includes(body.resolution || '') || body.providerChecked !== true) {
    return json({ error: 'Se requiere id, resolución sent/failed y providerChecked=true' }, { status: 400 })
  }
  if (body.providerMessageId && (body.providerMessageId.length > 256 || /[\r\n]/.test(body.providerMessageId))) {
    return json({ error: 'providerMessageId inválido' }, { status: 400 })
  }

  try {
    const result = await reconcileUnknownChannelOutboundMessage({
      id: body.id,
      resolution: body.resolution as 'sent' | 'failed',
      providerMessageId: body.providerMessageId || null,
    })
    return json({ ok: true, resolution: body.resolution, messageId: result?.id ?? null })
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'NOT_FOUND') return json({ error: 'Intención no encontrada' }, { status: 404 })
    if (code === 'INVALID_STATE') return json({ error: 'La intención no está en estado unknown' }, { status: 409 })
    throw error
  }
}
