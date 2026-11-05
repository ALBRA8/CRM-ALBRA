import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { signToken } from '@/lib/auth'
import { handle, json, jsonWithSession } from '../../_lib/shared'
import { ensureDemoOrganization } from '../../_lib/demo-seed'
import { rateLimit, rateLimited, clientIp } from '@/lib/rate-limit'

/**
 * POST /api/auth/demo — crea o reutiliza la organización demo y devuelve sesión.
 * Reparación integral B2: rate limit 5/hora por IP (el endpoint es anónimo y
 * semilla datos: sin límite es una vía barata de hinchado de BD).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const rl = rateLimit(`demo:${clientIp(req)}`, 5, 3_600_000)
    if (!rl.ok) return rateLimited(rl)

    const demo = await ensureDemoOrganization()
    const user = await db.user.findUnique({ where: { id: demo.userId } })
    if (!user) {
      return json({ error: 'No se pudo preparar la cuenta demo' }, { status: 500 })
    }
    // B4: el JWT lleva tokenVersion para la revocación de sesiones
    const token = signToken({ userId: user.id, orgId: demo.orgId, role: user.role, email: user.email, tokenVersion: user.tokenVersion })
    return jsonWithSession({
      token,
      demo: true,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
