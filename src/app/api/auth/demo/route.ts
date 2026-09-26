import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { signToken } from '@/lib/auth'
import { handle, json, jsonWithSession } from '../../_lib/shared'
import { ensureDemoOrganization } from '../../_lib/demo-seed'

/** POST /api/auth/demo — crea o reutiliza la organización demo y devuelve sesión. */
export async function POST(_req: NextRequest) {
  return handle(async () => {
    const demo = await ensureDemoOrganization()
    const user = await db.user.findUnique({ where: { id: demo.userId } })
    if (!user) {
      return json({ error: 'No se pudo preparar la cuenta demo' }, { status: 500 })
    }
    const token = signToken({ userId: user.id, orgId: demo.orgId, role: user.role, email: user.email })
    return jsonWithSession({
      token,
      demo: true,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
