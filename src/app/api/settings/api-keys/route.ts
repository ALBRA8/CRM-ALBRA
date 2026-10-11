import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, json, readBody, str } from '../../_lib/shared'
import { generateApiKey } from '@/lib/api-keys'

/**
 * GET /api/settings/api-keys — lista las claves MCP de la organización
 * (SIN el hash: prefijo + metadatos solamente).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const keys = await db.apiKey.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    })
    return json({ apiKeys: keys })
  })
}

/**
 * POST /api/settings/api-keys — crea una clave nueva. La clave cruda se
 * devuelve UNA sola vez en `secret`; después es imposible recuperarla.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = await readBody(req)
    const name = str(body.name) ?? 'Clave MCP'
    const { raw, hashedKey, prefix } = generateApiKey()
    const created = await db.apiKey.create({
      data: {
        organizationId: auth.orgId,
        name,
        hashedKey,
        prefix,
        createdById: auth.userId,
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    })
    return json({ apiKey: created, secret: raw }, { status: 201 })
  })
}
