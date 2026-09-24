import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { handle, json, readBody } from '../../_lib/shared'

/** PUT /api/notifications/:id — marca/desmarca como leída ({ isRead }). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const notification = await db.notification.findFirst({ where: { id, organizationId: auth.orgId } })
    if (!notification) throw new HttpError(404, 'Notificación no encontrada')

    const body = await readBody(req)
    const isRead = body.isRead === true || body.isRead === 'true'
    const updated = await db.notification.update({ where: { id }, data: { isRead } })
    return json({ notification: { ...updated, message: updated.body, link: null } })
  })
}

/** DELETE /api/notifications/:id */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const notification = await db.notification.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true } })
    if (!notification) throw new HttpError(404, 'Notificación no encontrada')
    await db.notification.delete({ where: { id } })
    return json({ success: true })
  })
}
