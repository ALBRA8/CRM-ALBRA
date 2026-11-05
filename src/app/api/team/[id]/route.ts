import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, str } from '../../_lib/shared'
import { bumpTokenVersionForUser } from '@/lib/session-version'

/** PUT /api/team/:id — actualiza rol/datos de un miembro de la MISMA organización. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const { id } = await params
    const member = await db.user.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    })
    if (!member) throw new HttpError(404, 'Miembro no encontrado')
    // Blindaje de plataforma: el rol superadmin no se degrada ni se desactiva
    // por API (su ciclo de vida es solo scripts/promote-superadmin.mjs).
    if (member.role === 'superadmin') {
      throw new HttpError(403, 'El superadmin de plataforma no se gestiona por API de equipo')
    }
    const body = await readBody(req)

    const data: Record<string, unknown> = {}
    if ('name' in body) data.name = str(body.name) ?? member.name
    if ('phone' in body) data.phone = str(body.phone)
    if ('role' in body) {
      const requestedRole = str(body.role)
      if (requestedRole) {
        if (member.role === 'owner') throw new HttpError(400, 'No se puede cambiar el rol del propietario')
        if (requestedRole === 'owner') throw new HttpError(400, 'No se puede asignar el rol de propietario')
        if (!['admin', 'agent', 'member'].includes(requestedRole)) throw new HttpError(400, 'Rol no válido')
        data.role = requestedRole
      }
    }
    if ('isActive' in body && member.role !== 'owner') {
      data.isActive = body.isActive === true || body.isActive === 'true'
    }

    const updated = await db.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, phone: true, company: true, avatar: true, isActive: true, createdAt: true },
    })
    // B4: desactivar a un miembro revoca sus sesiones vigentes (JWT de 7 días).
    if (data.isActive === false) {
      const bumped = await db.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } }, select: { tokenVersion: true } })
      bumpTokenVersionForUser(id, bumped.tokenVersion)
    }
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'user',
      entityId: id,
      details: { name: updated.name, fields: Object.keys(body).slice(0, 10) },
    })
    return json({ member: updated })
  })
}

/** DELETE /api/team/:id — desactiva (isActive=false), nunca borra. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const { id } = await params
    const member = await db.user.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, name: true, role: true },
    })
    if (!member) throw new HttpError(404, 'Miembro no encontrado')
    if (member.role === 'owner') throw new HttpError(400, 'No se puede desactivar al propietario')
    if (member.role === 'superadmin') {
      throw new HttpError(403, 'El superadmin de plataforma no se desactiva por API de equipo')
    }
    if (member.id === auth.userId) throw new HttpError(400, 'No puedes desactivarte a ti mismo')

    // B4: la desactivación revoca las sesiones del miembro (tokenVersion++).
    const bumped = await db.user.update({ where: { id }, data: { isActive: false, tokenVersion: { increment: 1 } }, select: { tokenVersion: true } })
    bumpTokenVersionForUser(id, bumped.tokenVersion)
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'user',
      entityId: id,
      details: { name: member.name, deactivated: true },
    })
    return json({ success: true })
  })
}
