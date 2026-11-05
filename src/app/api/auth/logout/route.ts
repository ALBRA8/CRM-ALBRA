import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, getAuth } from '@/lib/auth'
import { bumpTokenVersionForUser } from '@/lib/session-version'

/**
 * POST /api/auth/logout — borra la cookie de sesión httpOnly y REVOKA el JWT
 * (reparación integral B4): incrementa tokenVersion del usuario para que el
 * token de 7 días ya emitido deje de ser aceptado de inmediato (antes solo se
 * borraba la cookie y el JWT seguía vivo en cualquier otro canal).
 * El cliente además limpia su estado en memoria (store zustand).
 * Idempotente: llamarla sin sesión es seguro (solo expira la cookie).
 */
export async function POST(req: NextRequest) {
  // Revocación best-effort: si la llamada trae sesión (Bearer o cookie),
  // se incrementa la versión del usuario en BD y en el caché del proceso.
  try {
    const auth = getAuth(req)
    if (auth) {
      const updated = await db.user.update({
        where: { id: auth.userId },
        data: { tokenVersion: { increment: 1 } },
        select: { id: true, tokenVersion: true },
      })
      bumpTokenVersionForUser(updated.id, updated.tokenVersion)
    }
  } catch {
    // Sin sesión válida o error transitorio: el logout sigue siendo idempotente
    // y la cookie se expira igualmente.
  }

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
