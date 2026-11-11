import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { signToken } from '@/lib/auth'
import { handle, json, jsonWithSession } from '../../_lib/shared'
import { ensureDemoOrganization } from '../../_lib/demo-seed'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'
import { HttpError } from '@/lib/auth'

/**
 * POST /api/auth/demo — crea o reutiliza la organización demo y devuelve sesión.
 *
 * (A2-01, auditoría 2026-11-11) ENDERAZO DE PRODUCCIÓN: la sesión demo es una
 * sesión owner REAL — sin gate, cualquier anónimo en producción crea
 * organizaciones y consume coste de IA/LLM sin límite. Solo está abierta si
 * DEMO_MODE=true (preview/desarrollo) y SIEMPRE con límite durable por IP.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
      throw new HttpError(403, 'El modo demo no está disponible')
    }
    const rl = await dbRateLimit(`demo:${clientIp(req)}`, 10, 60 * 60 * 1000)
    if (!rl.ok) {
      throw new HttpError(429, 'Demasiadas sesiones demo desde esta IP. Inténtalo más tarde.')
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
