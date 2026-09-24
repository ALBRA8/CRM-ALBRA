import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { sendEmail, sendTemplateEmail } from '@/lib/email'

export async function POST(request: NextRequest) {
  const perm = await checkPermission(request, 'templates', 'read')
  if (perm instanceof NextResponse) return perm

  const body = await request.json()

  // Option 1: Send with template
  if (body.templateId) {
    const result = await sendTemplateEmail({
      to: body.to,
      templateId: body.templateId,
      variables: body.variables || {},
      userId: perm.userId,
    })
    if (result.success) {
      return NextResponse.json({ message: 'Email enviado correctamente' })
    }
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  // Option 2: Send custom email
  if (!body.to || !body.subject || !body.html) {
    return NextResponse.json({ error: 'Campos requeridos: to, subject, html' }, { status: 400 })
  }

  const result = await sendEmail({
    to: body.to,
    subject: body.subject,
    html: body.html,
    text: body.text,
    replyTo: body.replyTo,
  })

  if (result.success) {
    return NextResponse.json({ message: 'Email enviado correctamente', messageId: result.messageId })
  }
  return NextResponse.json({ error: result.error }, { status: 500 })
}
