import { db } from '@/lib/db'
import { sendEmail, isEmailConfigured } from '@/lib/email'

export async function logActivity(params: {
  userId: string
  action: string
  entity: string
  entityId?: string
  description: string
  metadata?: Record<string, unknown>
}) {
  try {
    await db.activityLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        description: params.description,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    })
  } catch (error) {
    console.error('Failed to log activity:', error)
  }
}

// Notification types that should trigger an email
const EMAIL_NOTIFICATION_TYPES = ['lead', 'opportunity', 'alert']

export async function createNotification(params: {
  userId: string
  type: string
  title: string
  message: string
  link?: string
}) {
  try {
    await db.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        link: params.link || null,
      },
    })

    // Send email for important notification types if email is configured
    if (EMAIL_NOTIFICATION_TYPES.includes(params.type) && isEmailConfigured()) {
      try {
        const user = await db.user.findUnique({
          where: { id: params.userId },
          select: { email: true, name: true },
        })
        if (user?.email) {
          await sendEmail({
            to: user.email,
            subject: `[CRM ALBRA] ${params.title}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #059669, #0d9488); padding: 24px; border-radius: 12px 12px 0 0;">
                  <h2 style="color: white; margin: 0; font-size: 20px;">CRM ALBRA</h2>
                </div>
                <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
                  <h3 style="color: #1e293b; margin: 0 0 12px;">${params.title}</h3>
                  <p style="color: #475569; line-height: 1.6;">${params.message}</p>
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
                  <p style="color: #94a3b8; font-size: 12px;">Esta notificacion fue generada automaticamente por CRM ALBRA.</p>
                </div>
              </div>
            `,
            text: `${params.title}\n\n${params.message}\n\n— CRM ALBRA`,
          })
        }
      } catch (emailError) {
        // Email failure should not block the notification
        console.error('Failed to send notification email:', emailError)
      }
    }
  } catch (error) {
    console.error('Failed to create notification:', error)
  }
}
