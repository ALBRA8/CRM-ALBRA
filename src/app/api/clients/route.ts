import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { auditAndTimeline, parseIntParam, paginationMeta } from '@/lib/api-helpers'
import { runWorkflowsForTrigger } from '@/lib/workflow-engine'
import { handle, json, readBody, requireFields, str, dateOrNull, qparam } from '../_lib/shared'
import { loadClientAttrs, saveClientAttrs, serializeClient } from '../_lib/clients'

/** GET /api/clients — listado paginado con búsqueda, filtros y atributos extendidos. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const page = parseIntParam(req, 'page', 1)
    const limit = parseIntParam(req, 'limit', 20, 1, 200)

    // El frontend envía `search`; el contrato también acepta `q`.
    const q = qparam(req, 'search') ?? qparam(req, 'q')
    const status = qparam(req, 'status')
    const temperature = qparam(req, 'temperature')
    const source = qparam(req, 'source')
    const assignedToId = qparam(req, 'assignedToId')

    const where: Prisma.ClientWhereInput = { organizationId: auth.orgId }
    if (q) {
      where.OR = [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }]
    }
    if (status) where.status = status
    if (source) where.source = source
    if (assignedToId) where.assignedToId = assignedToId
    // temperature vive en customFieldValues (polimórfico, sin relación): filtrar por IDs
    if (temperature) {
      const matching = await db.customFieldValue.findMany({
        where: {
          organizationId: auth.orgId,
          entityType: 'client',
          value: temperature,
          field: { name: 'temperature', entity: 'client', organizationId: auth.orgId },
        },
        select: { entityId: true },
      })
      if (matching.length === 0) {
        return json({
          clients: [],
          pagination: { ...paginationMeta(page, limit, 0), limit },
        })
      }
      where.id = { in: matching.map((m) => m.entityId) }
    }

    const total = await db.client.count({ where })
    const clients = await db.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { _count: { select: { opportunities: true, reservations: true } } },
    })

    const attrsMap = await loadClientAttrs(auth.orgId, clients.map((c) => c.id))
    return json({
      clients: clients.map((c) => serializeClient(c, attrsMap.get(c.id))),
      // `limit` lo consume clients-list.tsx; `pageSize` mantiene el contrato del API.
      pagination: { ...paginationMeta(page, limit, total), limit },
    })
  })
}

/** POST /api/clients — crea cliente, dispara workflows y registra auditoría+timeline. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = await readBody(req)
    requireFields(body, ['name', 'phone'])

    const created = await db.client.create({
      data: {
        organizationId: auth.orgId,
        name: str(body.name) as string,
        phone: str(body.phone) as string,
        email: str(body.email),
        cedula: str(body.identifier) ?? str(body.cedula),
        address: str(body.address),
        notes: str(body.notes),
        status: str(body.status) ?? 'prospect',
        source: str(body.source) ?? 'manual',
        lastContactAt: dateOrNull(body.lastContactAt) ?? new Date(),
        assignedToId: str(body.assignedToId),
        createdById: auth.userId,
      },
    })

    await saveClientAttrs(auth.orgId, created.id, body)
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'client',
      entityId: created.id,
      details: { name: created.name },
      clientId: created.id,
      timelineType: 'system',
      timelineTitle: `Cliente creado: ${created.name}`,
    })
    await runWorkflowsForTrigger({
      orgId: auth.orgId,
      type: 'client_created',
      payload: {
        clientId: created.id,
        id: created.id,
        name: created.name,
        clientName: created.name,
        phone: created.phone,
        email: created.email,
        source: created.source,
        status: created.status,
      },
    })

    const attrs = await loadClientAttrs(auth.orgId, [created.id])
    return json({ client: serializeClient(created, attrs.get(created.id)) }, { status: 201 })
  })
}
