import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, requireAdmin, HttpError, hashPassword } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, requireFields, str } from '../_lib/shared'

function serializeMember(user: {
  id: string
  name: string
  email: string
  role: string
  phone: string | null
  company: string | null
  avatar: string | null
  isActive: boolean
  createdAt: Date
}, counts: { clients: number; opportunities: number }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    company: user.company,
    avatar: user.avatar,
    isActive: user.isActive,
    createdAt: user.createdAt,
    _count: counts,
  }
}

/**
 * GET /api/team — miembros SOLO de la organización del token
 * (aislamiento multi-tenant; nunca usuarios globales).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const members = await db.user.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, email: true, role: true, phone: true,
        company: true, avatar: true, isActive: true, createdAt: true,
      },
    })

    const ids = members.map((m) => m.id)
    const [clientsByAssigned, clientsByCreator, oppsByAssigned, oppsByCreator] = await Promise.all([
      db.client.groupBy({ by: ['assignedToId'], where: { organizationId: auth.orgId, assignedToId: { in: ids } }, _count: true }),
      db.client.groupBy({ by: ['createdById'], where: { organizationId: auth.orgId, createdById: { in: ids } }, _count: true }),
      db.opportunity.groupBy({ by: ['assignedToId'], where: { organizationId: auth.orgId, assignedToId: { in: ids } }, _count: true }),
      db.opportunity.groupBy({ by: ['createdById'], where: { organizationId: auth.orgId, createdById: { in: ids } }, _count: true }),
    ])

    const clientCounts = new Map<string, number>()
    const oppCounts = new Map<string, number>()
    const add = (map: Map<string, number>, key: string | null, value: number) => {
      if (!key) return
      map.set(key, (map.get(key) ?? 0) + value)
    }
    for (const row of clientsByAssigned) add(clientCounts, row.assignedToId, row._count)
    for (const row of clientsByCreator) add(clientCounts, row.createdById, row._count)
    for (const row of oppsByAssigned) add(oppCounts, row.assignedToId, row._count)
    for (const row of oppsByCreator) add(oppCounts, row.createdById, row._count)

    return json({
      members: members.map((m) => serializeMember(m, { clients: clientCounts.get(m.id) ?? 0, opportunities: oppCounts.get(m.id) ?? 0 })),
    })
  })
}

/** POST /api/team — invita un miembro a la MISMA organización (rol del body). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = await readBody(req)
    requireFields(body, ['name', 'email', 'password'])

    const email = (str(body.email) as string).toLowerCase()
    const password = str(body.password) as string
    if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email inválido')

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) throw new HttpError(409, 'Ya existe una cuenta con este email')

    const requestedRole = str(body.role) ?? 'member'
    if (requestedRole === 'owner') throw new HttpError(400, 'No se puede crear otro propietario')
    const role = ['admin', 'agent', 'member'].includes(requestedRole) ? requestedRole : 'member'

    const created = await db.user.create({
      data: {
        email,
        name: str(body.name) as string,
        passwordHash: hashPassword(password),
        phone: str(body.phone),
        role,
        organizationId: auth.orgId,
      },
      select: {
        id: true, name: true, email: true, role: true, phone: true,
        company: true, avatar: true, isActive: true, createdAt: true,
      },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'created',
      entity: 'user',
      entityId: created.id,
      details: { name: created.name, role: created.role },
    })
    return json({ member: serializeMember(created, { clients: 0, opportunities: 0 }) }, { status: 201 })
  })
}
