import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { getAccessToken, sendGmailMessage } from '@/lib/google'
import { recordTimelineEvent } from '@/lib/timeline'

/**
 * POST /api/google/gmail/send — envía email con la cuenta Gmail conectada.
 * Degrada elegante: sin conexión → 400 descriptivo (nunca 500); si la API falla,
 * registra el mensaje en el timeline y responde queued.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as { to?: string; subject?: string; html?: string; clientId?: string }
    requireFields(body as unknown as Record<string, unknown>, ['to', 'subject'])
    const to = String(body.to).trim()
    const subject = String(body.subject).slice(0, 200)
    const html = String(body.html || '').slice(0, 50000) || `<p>${subject}</p>`

    const accessToken = await getAccessToken(auth.orgId)
    if (!accessToken) {
      return json({ error: 'Gmail no conectado. Conecta tu cuenta de Google en Configuración → Google.' }, { status: 400 })
    }

    const result = await sendGmailMessage(accessToken, to, subject, html)
    if (result.ok) {
      await recordTimelineEvent({
        orgId: auth.orgId,
        clientId: body.clientId || null,
        type: 'email',
        title: `Email Gmail enviado: ${subject}`,
        description: `Para: ${to}`,
        metadata: { channel: 'gmail', messageId: result.id },
        source: 'integration',
        userId: auth.userId,
      })
      return json({ success: true, sent: true, id: result.id })
    }

    await recordTimelineEvent({
      orgId: auth.orgId,
      clientId: body.clientId || null,
      type: 'email',
      title: `Email Gmail no enviado: ${subject}`,
      description: `Para: ${to}. ${result.error || ''}`,
      metadata: { channel: 'gmail', error: result.error },
      source: 'integration',
      userId: auth.userId,
    })
    return json({ queued: true, note: `Gmail API no pudo enviar (${result.error}). Mensaje registrado en el timeline.` })
  })
}
