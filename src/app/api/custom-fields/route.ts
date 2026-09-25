import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, requireFields, str, numOrNull, bool, qparam } from '../_lib/shared'
import { CLIENT_ATTR_KEYS } from '../_lib/clients'
import { serializeField } from '../_lib/custom-fields'

/** GET /api/custom-fields?entity= — definiciones visibles (excluye campos de sistema). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const entity = qparam(req, 'entity')
    const where: Prisma.CustomFieldWhereInput = {
      organizationId: auth.orgId,
      ...(entity ? { entity } : {}),
      name: { notIn: CLIENT_ATTR_KEYS },
    }
    const fields = await db.customField.findMany({ where, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] })
    return json({ fields: fields.map(serializeField) })
  })
}

/** POST /api/custom-fields — { name, fieldType|type, entity, options?, isRequired?, order? } */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = await readBody(req)
    requireFields(body, ['name', 'entity'])

    const name = str(body.name) as string
    const created = await db.customField.create({
      data: {
        organizationId: auth.orgId,
        entity: str(body.entity) as string,
        name,
        label: str(body.label) ?? name,
        type: str(body.fieldType) ?? str(body.type) ?? 'text',
        options: str(body.options),
        isRequired: bool(body.isRequired, false),
        order: numOrNull(body.order) ?? 0,
      },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'custom_field',
      entityId: created.id,
      details: { name: created.name, entity: created.entity },
    })
    return json({ field: serializeField(created) }, { status: 201 })
  })
}
