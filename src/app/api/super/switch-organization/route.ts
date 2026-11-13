import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, signToken, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../_lib/shared'

/**
 * POST /api/super/switch-organization
 * Cambia el contexto activo de un superadmin de plataforma.
 * No concede membresía ni modifica organizationId del usuario.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireSuperAdmin(req)
    const body = await readBody(req)
    requireFields(body, ['organizationId'])
    const organizationId = str(body.organizationId) as string

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true, isActive: true },
    })
    if (!organization || !organization.isActive) {
      throw new HttpError(404, 'Organización no encontrada o inactiva')
    }

    const token = signToken({
      userId: auth.userId,
      orgId: organization.id,
      role: auth.role,
      email: auth.email,
      tv: auth.tv,
    })

    await auditAndTimeline({
      orgId: organization.id,
      userId: auth.userId,
      action: 'switched_context',
      entity: 'organization',
      entityId: organization.id,
      details: { organizationName: organization.name, previousOrgId: auth.orgId },
    })

    return jsonWithSession({
      token,
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
    }, token)
  })
}
