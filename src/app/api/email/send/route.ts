import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { recordTimelineEvent } from '@/lib/timeline'
import { getSmtpConfig, trySendSmtp } from '@/lib/mail'

/**
 * POST /api/email/send — envío de correo.
 * 1) Si hay SMTP configurado (Settings o variables de entorno SMTP_*) intenta nodemailer.
 * 2) Si no hay SMTP (o falla), registra el mensaje en el timeline y responde
 *    { queued: true, note } SIN error 500 (degradación elegante).
 */

interface EmailBody {
  to?: string
  subject?: string
  html?: string
  text?: string
  templateId?: string
  variables?: Record<string, string>
  clientId?: string
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as EmailBody
    requireFields(body as unknown as Record<string, unknown>, ['to', 'subject'])
    const to = String(body.to).trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ error: 'Email de destino inválido' }, { status: 400 })
    }

    let subject = String(body.subject).slice(0, 200)
    let html = String(body.html || body.text || '').slice(0, 50000)

    // Plantilla opcional con variables {{var}}
    if (body.templateId) {
      const template = await db.template.findFirst({ where: { id: body.templateId, organizationId: auth.orgId } })
      if (template) {
        if (template.subject) subject = template.subject
        const rendered = template.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => body.variables?.[key] ?? `{{${key}}}`)
        if (!body.html) html = `<div>${rendered.replace(/\n/g, '<br/>')}</div>`
      }
    }

    const cfg = await getSmtpConfig(auth.orgId)
    if (cfg) {
      const result = await trySendSmtp(cfg, to, subject, html, body.text)
      if (result.ok) {
        await recordTimelineEvent({
          orgId: auth.orgId,
          clientId: body.clientId || null,
          type: 'email',
          title: `Email enviado: ${subject}`,
          description: `Para: ${to}`,
          metadata: { messageId: result.messageId, channel: 'smtp' },
          source: 'manual',
          userId: auth.userId,
        })
        return json({ success: true, sent: true, messageId: result.messageId })
      }
      // SMTP configurado pero falló: registrar y degradar sin 500
      await recordTimelineEvent({
        orgId: auth.orgId,
        clientId: body.clientId || null,
        type: 'email',
        title: `Email registrado (SMTP falló): ${subject}`,
        description: `Para: ${to}. Error: ${result.error || 'desconocido'}`,
        metadata: { channel: 'smtp', error: result.error },
        source: 'manual',
        userId: auth.userId,
      })
      return json({ queued: true, note: `SMTP no pudo enviar (${result.error}). Mensaje registrado en el timeline.` })
    }

    // Sin SMTP: registrar y degradar
    await recordTimelineEvent({
      orgId: auth.orgId,
      clientId: body.clientId || null,
      type: 'email',
      title: `Email registrado: ${subject}`,
      description: `Para: ${to}. ${html.slice(0, 200)}`,
      metadata: { channel: 'logged', variables: body.variables || {} },
      source: 'manual',
      userId: auth.userId,
    })
    return json({ queued: true, note: 'SMTP no configurado, mensaje registrado' })
  })
}
