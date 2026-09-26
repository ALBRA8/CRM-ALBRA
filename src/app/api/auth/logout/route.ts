import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

/**
 * POST /api/auth/logout — borra la cookie de sesión httpOnly.
 * El cliente además limpia su estado en memoria (store zustand).
 * Idempotente: llamarla sin cookie es seguro.
 */
export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return res
}
