import { db } from './db'
import { decryptSecret } from './crypto'

/**
 * Envío de email con degradación elegante.
 * Prioridad de configuración SMTP: Settings de la org → variables de entorno SMTP_*.
 * El import de nodemailer es dinámico: si la dependencia no está disponible,
 * el envío degrada sin romper (útil cuando la instalación del paquete falla).
 */

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

export async function getSmtpConfig(orgId: string): Promise<SmtpConfig | null> {
  const settings = await db.settings.findUnique({ where: { organizationId: orgId } })
  const host = settings?.smtpHost || process.env.SMTP_HOST || null
  const port = settings?.smtpPort || (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587)
  const user = settings?.smtpUser || process.env.SMTP_USER || null
  const pass = decryptSecret(settings?.smtpPassEnc) || process.env.SMTP_PASS || null
  const from = process.env.SMTP_FROM_NAME || 'CRM ALBRA'
  if (!host || !user || !pass) return null
  return { host, port, user, pass, from }
}

export async function trySendSmtp(
  cfg: SmtpConfig,
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const mod = (await import('nodemailer')) as { default?: typeof import('nodemailer') } & typeof import('nodemailer')
    const nodemailer = mod.default && 'createTransport' in mod.default ? mod.default : mod
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    })
    const info = await transporter.sendMail({
      from: `"${cfg.from}" <${cfg.user}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
    })
    return { ok: true, messageId: info.messageId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
