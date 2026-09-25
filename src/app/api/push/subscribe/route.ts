import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * POST /api/push/subscribe — guarda la suscripción web-push del navegador.
 * La suscripción se persiste como Notification type="push_subscription"
 * (data = JSON { endpoint, keys }) sin schema nuevo. Dedupe por endpoint.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    requireFields(body as unknown as Record<string, unknown>, ['endpoint'])
    if (!body.keys?.p256dh || !body.keys?.auth) {
      return json({ error: 'keys.p256dh y keys.auth son requeridos' }, { status: 400 })
    }

    // Dedupe por endpoint dentro de la organización
    const existing = await db.notification.findMany({
      where: { organizationId: auth.orgId, type: 'push_subscription', data: { contains: body.endpoint } },
      select: { id: true },
    })
    if (existing.length > 0) {
      await db.notification.deleteMany({ where: { id: { in: existing.map((n) => n.id) }, userId: auth.userId } })
      const others = await db.notification.findMany({
        where: { organizationId: auth.orgId, type: 'push_subscription', data: { contains: body.endpoint }, userId: { not: auth.userId } },
        select: { id: true },
      })
      if (others.length > 0) await db.notification.deleteMany({ where: { id: { in: others.map((n) => n.id) } } })
    }

    const subscription = await db.notification.create({
      data: {
        organizationId: auth.orgId,
        userId: auth.userId,
        type: 'push_subscription',
        title: 'Suscripción push',
        body: body.endpoint ? new URL(String(body.endpoint)).hostname : 'suscripción',
        data: JSON.stringify({ endpoint: body.endpoint, keys: body.keys }),
      },
    })

    // Envío de bienvenida best-effort (no obligatorio; falla silenciosamente)
    try {
      const settings = await db.settings.findUnique({ where: { organizationId: auth.orgId }, select: { vapidPublicKey: true, vapidPrivateKeyEnc: true } })
      if (settings?.vapidPublicKey && settings.vapidPrivateKeyEnc) {
        const { decryptSecret } = await import('@/lib/crypto')
        const webpushMod = (await import('web-push')) as unknown as {
          default?: { sendNotification: (sub: unknown, payload?: string, options?: unknown) => Promise<unknown> }
          sendNotification?: (sub: unknown, payload?: string, options?: unknown) => Promise<unknown>
        }
        const webpush = webpushMod.default && 'sendNotification' in webpushMod.default ? webpushMod.default : webpushMod
        if (webpush.sendNotification) {
          const privateKey = decryptSecret(settings.vapidPrivateKeyEnc)
          if (privateKey) {
            await webpush.sendNotification(
              { endpoint: body.endpoint, keys: body.keys },
              JSON.stringify({ title: 'CRM ALBRA', body: 'Notificaciones activadas ✔' }),
              { vapidDetails: { subject: 'mailto:support@crm-albra.app', publicKey: settings.vapidPublicKey, privateKey } }
            )
          }
        }
      }
    } catch (err) {
      console.error('[push/subscribe] push de bienvenida falló (no crítico)', err)
    }

    return json({ success: true, subscriptionId: subscription.id })
  })
}
