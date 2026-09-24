import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyToken, hashPassword } from '@/lib/auth'
import { validateResetToken, consumeResetToken } from '@/lib/reset-tokens'

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json({ error: 'Token y nueva contraseña son requeridos' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
    }

    // Verify token
    const payload = await verifyToken(token)
    if (!payload?.userId) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 400 })
    }

    // Check if token is in reset tokens store
    if (!validateResetToken(payload.userId, token)) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 400 })
    }

    // Hash new password
    const hashedPassword = await hashPassword(password)

    // Update user password
    await db.user.update({
      where: { id: payload.userId },
      data: { password: hashedPassword },
    })

    // Consume the token so it can't be reused
    consumeResetToken(payload.userId, token)

    return NextResponse.json({ success: true, message: 'Contraseña actualizada exitosamente' })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Error al restablecer contraseña' }, { status: 500 })
  }
}
