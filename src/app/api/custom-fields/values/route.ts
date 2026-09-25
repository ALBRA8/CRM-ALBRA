import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, str, qparam } from '../../_lib/shared'
import { serializeField } from '../../_lib/custom-fields'

/** GET /api/custom-fields/values?entityId= — valores de campos para una entidad. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const entityId = qparam(req, 'entityId')
    if (!entityId) throw new HttpError(400, 'Falta el parámetro entityId')

    const values = await db.customFieldValue.findMany({
      where: { organizationId: auth.orgId, entityId },
      include: { field: true },
      orderBy: { field: { order: 'asc' } },
    })
    return json({
      values: values.map((v) => ({
        id: v.id,
        fieldId: v.fieldId,
        entityType: v.entityType,
        entityId: v.entityId,
        value: v.value,
        field: serializeField(v.field),
      })),
    })
  })
}

/**
 * POST /api/custom-fields/values — guarda múltiples fieldId→value.
 * Body: { entityId, fields: [{ fieldId, value }] } (o { entityId, values: {fieldId: value} }).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    const entityId = str(body.entityId)
    if (!entityId) throw new HttpError(400, 'Falta entityId')

    // Normaliza ambas formas del body a [{ fieldId, value }]
    const entries: Array<{ fieldId: string; value: string | null }> = []
    if (Array.isArray(body.fields)) {
      for (const raw of body.fields) {
        const fieldId = str(raw.fieldId)
        if (fieldId) entries.push({ fieldId, value: str(raw.value) })
      }
    } else if (body.values && typeof body.values === 'object' && !Array.isArray(body.values)) {
      for (const [fieldId, value] of Object.entries(body.values as Record<string, unknown>)) {
        entries.push({ fieldId, value: str(value) })
      }
    }
    if (entries.length === 0) throw new HttpError(400, 'No hay valores para guardar')

    // Todos los campos deben pertenecer a la organización
    const fieldIds = entries.map((e) => e.fieldId)
    const fields = await db.customField.findMany({
      where: { id: { in: fieldIds }, organizationId: auth.orgId },
      select: { id: true, entity: true },
    })
    if (fields.length !== new Set(fieldIds).size) {
      throw new HttpError(400, 'Algún campo no existe en esta organización')
    }
    const entityByField = new Map(fields.map((f) => [f.id, f.entity]))

    const saved: Array<{ fieldId: string; value: string | null }> = []
    for (const entry of entries) {
      const entityType = entityByField.get(entry.fieldId)
      if (!entityType) continue
      if (entry.value === null || entry.value === '') {
        await db.customFieldValue.deleteMany({ where: { organizationId: auth.orgId, fieldId: entry.fieldId, entityId } })
      } else {
        await db.customFieldValue.upsert({
          where: { fieldId_entityId: { fieldId: entry.fieldId, entityId } },
          create: { organizationId: auth.orgId, fieldId: entry.fieldId, entityType, entityId, value: entry.value },
          update: { value: entry.value },
        })
      }
      saved.push({ fieldId: entry.fieldId, value: entry.value })
    }

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'custom_field_value',
      entityId,
      details: { fields: fieldIds.slice(0, 10) },
    })

    return json({ success: true, values: saved })
  })
}
