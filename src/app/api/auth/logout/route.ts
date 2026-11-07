import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuth, SESSION_COOKIE } from '@/lib/auth'
import { bumpTokenVersion } from '@/lib/session-invalidation'
import { readBody } from '../../_lib/shared'

/**
 * POST /api/auth/logout — borra la cookie de sesión httpOnly.
 * El cliente además limpia su estado en memoria (store zustand).
 * Idempotente: llamarla sin cookie es seguro.
 *
 * (segunda reparación) Con { allDevices: true } y sesión válida, además revoca
 * PERSISTENTEMENTE todos los JWT del usuario (bump de tokenVersion): la sesión
 * actual y cualquier otra emitida dejan de funcionar en todas las instancias.
 */
export async function POST(req: NextRequest) {
  let allDevices = false
  try {
    const body = await readBody(req)
    allDevices = body.allDevices === true || body.allDevices === 'true'
  } catch {
    // cuerpo ausente o no-JSON: logout simple
  }
  if (allDevices) {
    const auth = getAuth(req) // verificación barata: firma+exp; el bump exige identidad concreta
    if (auth) {
      await bumpTokenVersion(auth.userId).catch(() => null) // fail-safe: el logout no se rompe por BD
    }
  }
  const res = NextResponse.json({ ok: true, allDevices })
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
