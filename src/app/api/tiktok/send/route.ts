import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { getIntegration, parseTikTokState, sendTikTokBusinessMessage } from '@/lib/integrations'
import { recordTimelineEvent } from '@/lib/timeline'

/**
 * POST /api/tiktok/send — { to: conversationId|userId, text }
 * Envía un DM por el Business Messaging API de TikTok. Sin acceso de socio
 * aprobado devuelve un error estructurado (notAuthorized), nunca un fallo silencioso.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as { to?: string; text?: string }
    const to = String(body.to || '').trim()
    const text = String(body.text || '').trim()
    if (!to || !text) return json({ error: 'Faltan to y text' }, { status: 400 })

    const integration = await getIntegration(auth.orgId)
    const state = parseTikTokState(integration.tiktokTokenEnc)

    const sent = await sendTikTokBusinessMessage({ state, recipientId: to, text })

    await recordTimelineEvent({
      orgId: auth.orgId,
      clientId: null,
      type: 'tiktok',
      title: sent.ok ? 'Mensaje enviado por TikTok' : 'Intento de envío por TikTok fallido',
      description: text.slice(0, 500),
      metadata: { to, direction: 'out', delivered: sent.ok, error: sent.error || null, notAuthorized: sent.notAuthorized || false },
      source: 'manual',
    })

    if (!sent.ok) {
      return json({ ok: false, notAuthorized: sent.notAuthorized || false, error: sent.error }, { status: sent.notAuthorized ? 409 : 502 })
    }
    return json({ ok: true })
  })
}
