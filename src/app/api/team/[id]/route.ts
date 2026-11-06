import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, str } from '../../_lib/shared'

/** PUT /api/team/:id — actualiza rol/datos de un miembro de la MISMA organización. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAdmin(req)
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
    // (segunda reparación) Todo cambio que afecte al JWT (rol, estado) lleva
    // DENTRO del mismo update el incremento atómico de tokenVersion: la
    // revocación de sesiones es inseparable del cambio de estado. Un cambio de
    // rol revoca también el claim `role` del token vigente (un admin degradado
    // pierde sus permisos al instante, no al expirar el JWT).
    if ('name' in body) data.name = str(body.name) ?? member.name
    if ('phone' in body) data.phone = str(body.phone)
    let mustRevoke = false
    if ('role' in body) {
      const requestedRole = str(body.role)
      if (requestedRole) {
        if (member.role === 'owner') throw new HttpError(400, 'No se puede cambiar el rol del propietario')
        if (requestedRole === 'owner') throw new HttpError(400, 'No se puede asignar el rol de propietario')
        if (!['admin', 'agent', 'member'].includes(requestedRole)) throw new HttpError(400, 'Rol no válido')
        if (requestedRole !== member.role) mustRevoke = true
        data.role = requestedRole
      }
    }
    if ('isActive' in body && member.role !== 'owner') {
      const nextActive = body.isActive === true || body.isActive === 'true'
      if (nextActive !== member.isActive) mustRevoke = true
      data.isActive = nextActive
    }
    if (mustRevoke) data.tokenVersion = { increment: 1 }

    const updated = await db.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, phone: true, company: true, avatar: true, isActive: true, createdAt: true },
    })
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
    const auth = await requireAdmin(req)
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

    // (segunda reparación) Desactivación + revocación de sesiones en UN SOLO
    // update atómico: no hay ventana en la que el usuario esté inactivo con
    // sesiones válidas, ni estado cambiado sin revocación.
    await db.user.update({ where: { id }, data: { isActive: false, tokenVersion: { increment: 1 } } })
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
