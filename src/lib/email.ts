import nodemailer from 'nodemailer'

interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  attachments?: Array<{
    filename: string
    content: Buffer | string
    contentType?: string
  }>
}

// Lazy-initialized transporter
let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    return null
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port: Number(port) || 587,
      secure: Number(port) === 465,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    })
  }

  return transporter
}

/**
 * Check if email is configured
 */
export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

/**
 * Send an email
 */
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const transport = getTransporter()

  if (!transport) {
    console.warn('Email not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS env vars.')
    return { success: false, error: 'Email no configurado. Configura las variables SMTP en .env' }
  }

  try {
    const fromName = process.env.SMTP_FROM_NAME || 'CRM ALBRA'
    const fromEmail = process.env.SMTP_USER

    const result = await transport.sendMail({
      from: options.from || `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || '',
      replyTo: options.replyTo,
      attachments: options.attachments,
    })

    return { success: true, messageId: result.messageId }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Email send error:', message)
    return { success: false, error: message }
  }
}

/**
 * Send email using a template from the database
 */
export async function sendTemplateEmail(params: {
  to: string
  templateId: string
  variables: Record<string, string>
  userId: string
}): Promise<{ success: boolean; error?: string }> {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: params.templateId, userId: params.userId, channel: 'email' },
    })

    if (!template) {
      return { success: false, error: 'Template no encontrado o no es de tipo email' }
    }

    // Replace variables in subject and body
    let subject = template.subject || 'Sin asunto'
    let body = template.content

    for (const [key, value] of Object.entries(params.variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
      subject = subject.replace(regex, value)
      body = body.replace(regex, value)
    }

    const result = await sendEmail({
      to: params.to,
      subject,
      html: body,
    })

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    return { success: false, error: message }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Test email configuration by sending a test email
 */
export async function testEmailConfig(toEmail: string): Promise<{ success: boolean; error?: string }> {
  return sendEmail({
    to: toEmail,
    subject: 'CRM ALBRA - Test de configuracion',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #059669, #0d9488); padding: 30px; border-radius: 12px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">CRM ALBRA</h1>
          <p style="color: #d1fae5; margin: 8px 0 0;">Configuracion de email exitosa</p>
        </div>
        <div style="padding: 20px; background: #f9fafb; border-radius: 0 0 12px 12px; margin-top: -4px;">
          <p style="color: #374151;">Si estas viendo este mensaje, tu configuracion SMTP es correcta y los emails se enviaran correctamente.</p>
          <p style="color: #6b7280; font-size: 12px;">Enviado: ${new Date().toLocaleString('es-MX')}</p>
        </div>
      </div>
    `,
    text: 'CRM ALBRA - Configuracion de email exitosa. Si estas viendo este mensaje, tu configuracion SMTP es correcta.',
  })
}
