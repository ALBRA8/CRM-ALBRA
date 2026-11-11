import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { signToken } from '@/lib/auth'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'
import { handle, json, jsonWithSession } from '../../_lib/shared'
import { ensureDemoOrganization } from '../../_lib/demo-seed'
import { HttpError } from '@/lib/auth'

/** POST /api/auth/demo — crea o reutiliza la organización demo y devuelve sesión. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    // (A2-15, auditoría 2026-11-11) La entrada anónima al demo es un vector de
    // abuso (siembra masiva de datos, fatiga de BD): en producción exige
    // DEMO_MODE=true de forma explícita y la ruta lleva rate limit DURABLE por IP.
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
      return json({ error: 'Modo demo deshabilitado' }, { status: 403 })
    }
    const rl = await dbRateLimit(`demo:${clientIp(req)}`, 10, 60_000)
    if (!rl.ok) {
      return json(
        { error: 'Demasiadas solicitudes. Intenta más tarde.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    const demo = await ensureDemoOrganization()
    const user = await db.user.findUnique({ where: { id: demo.userId } })
    if (!user) {
      return json({ error: 'No se pudo preparar la cuenta demo' }, { status: 500 })
    }
    const token = signToken({ userId: user.id, orgId: demo.orgId, role: user.role, email: user.email, tv: user.tokenVersion })
    return jsonWithSession({
      token,
      demo: true,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
