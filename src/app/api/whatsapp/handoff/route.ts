import type { NextRequest } from 'next/server'
import { json } from '@/lib/api-helpers'
import { recordTimelineEvent } from '@/lib/timeline'
import { notifyOrganization } from '@/lib/push'

/**
 * POST /api/whatsapp/handoff — ENDPOINT INTERNO (daemon Baileys → Next.js).
 *
 * Autenticación: header X-Internal-Secret === INTERNAL_API_SECRET (mismo patrón
 * que /api/whatsapp/transcribe y /api/whatsapp/describe-image). Sin sesión de
 * usuario: solo procesos internos.
 *
 * El daemon detectó que el cliente pide un humano (keywords de NichoConfig —
 * las mismas de Telegram/Instagram), YA pausó la IA localmente (isAutoReply=0)
 * y notifica aquí para que el equipo se entere:
 *   1. TimelineEvent type="whatsapp" en la ficha del cliente (trazabilidad).
 *   2. notifyOrganization → notificación in-app + web-push con deep-link /inbox.
 *
 * Body: { orgId, clientId?, conversationId?, contactPhone?, contactName?, text? }
 * Respuesta: { ok: true } | 400/401 con { error }.
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-internal-secret') || ''
  const expected = process.env.INTERNAL_API_SECRET || ''

  if (!expected || !provided || provided !== expected) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    orgId?: string
    clientId?: string | null
    conversationId?: string | null
    contactPhone?: string | null
    contactName?: string | null
    text?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, { status: 400 })
  }

  const orgId = (body.orgId || '').trim()
  if (!orgId) {
    return json({ error: 'orgId es requerido' }, { status: 400 })
  }

  const contactName = (body.contactName || body.contactPhone || 'Cliente').trim()

  // 1) Trazabilidad en la ficha del cliente (recordTimelineEvent nunca lanza).
  await recordTimelineEvent({
    orgId,
    clientId: body.clientId || null,
    type: 'whatsapp',
    title: '🤝 Handoff: el cliente pidió un humano — IA pausada',
    description: (body.text || '').slice(0, 300) || 'Solicitud de humano detectada por keyword',
    metadata: {
      conversationId: body.conversationId || null,
      contactPhone: body.contactPhone || null,
      handoff: true,
      direction: 'in',
    },
    source: 'system',
  })

  // 2) Notificación al equipo (in-app + web-push, deep-link a la bandeja).
  try {
    await notifyOrganization(orgId, {
      type: 'integration',
      title: `WhatsApp (${contactName}): pidió un humano`,
      body: 'La IA quedó pausada en esta conversación. Revísala en la Bandeja.',
      data: JSON.stringify({ clientId: body.clientId || null, channel: 'whatsapp' }),
    })
  } catch (err) {
    // La IA ya está pausada: la notificación no puede deshacer el handoff,
    // pero el log debe dejar constancia de que el aviso falló.
    console.error('[handoff] notifyOrganization falló', err)
    return json({ ok: true, notified: false }, { status: 200 })
  }

  return json({ ok: true, notified: true })
}
