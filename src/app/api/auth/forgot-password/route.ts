import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createToken } from '@/lib/auth'
import { sendEmail } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Email es requerido' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ success: true, message: 'Si el email existe, recibirás un enlace de recuperación' })
    }

    // Generate reset token (expires in 1 hour)
    const resetToken = await createToken({ userId: user.id, email: user.email })

    // Store the reset token in memory (simple approach for SQLite)
    // In production, use a separate table or Redis with expiry
    const { storeResetToken } = await import('@/lib/reset-tokens')
    storeResetToken(user.id, resetToken, 3600000) // 1 hour

    // Send reset email
    const appUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3000'
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`

    try {
      await sendEmail({
        to: email,
        subject: 'Recuperación de Contraseña - CRM ALBRA',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #059669; padding: 20px; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 20px;">CRM ALBRA</h1>
            </div>
            <div style="padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
              <h2 style="color: #1e293b; margin-top: 0;">Recuperación de Contraseña</h2>
              <p style="color: #64748b;">Hola ${user.name},</p>
              <p style="color: #64748b;">Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón de abajo para crear una nueva:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background: #059669; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
                  Restablecer Contraseña
                </a>
              </div>
              <p style="color: #94a3b8; font-size: 13px;">O copia este enlace en tu navegador:</p>
              <p style="color: #059669; font-size: 12px; word-break: break-all;">${resetUrl}</p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
              <p style="color: #94a3b8; font-size: 12px;">Este enlace expira en 1 hora. Si no solicitaste este cambio, puedes ignorar este correo.</p>
            </div>
          </div>
        `,
        text: `Hola ${user.name},\n\nPara restablecer tu contraseña, visita:\n${resetUrl}\n\nEste enlace expira en 1 hora.`,
      })
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError)
      // Return the token in dev mode for testing
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({
          success: true,
          message: 'Token generado (modo desarrollo - email no enviado)',
          devToken: resetToken,
        })
      }
      return NextResponse.json({ error: 'Error al enviar email de recuperación' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Si el email existe, recibirás un enlace de recuperación' })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
