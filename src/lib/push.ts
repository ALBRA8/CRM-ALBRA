import { db } from './db'
import { decryptSecret } from './crypto'

/**
 * Web-push saliente (Fase 4). Las suscripciones viven como Notification
 * type="push_subscription" (data = JSON { endpoint, keys }) — mismo contrato
 * que /api/push/subscribe. Las claves VAPID se generan en /api/push/vapid
 * (pública en Settings.vapidPublicKey, privada cifrada en vapidPrivateKeyEnc).
 *
 * Estrategia: fire-and-forget con allSettled — un fallo de push JAMÁS rompe
 * el flujo de negocio que la originó (webhook, handoff, workflow).
 * Suscripciones muertas (404/410) se eliminan para no acumular basura.
 */

export interface PushPayload {
  title: string
  body: string
  /** Ruta interna a abrir al hacer clic (default /dashboard). */
  url?: string
  tag?: string
}

interface PushSubscriptionLike {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function sendPushToOrganization(
  orgId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  try {
    const [subscriptions, settings] = await Promise.all([
      db.notification.findMany({
        where: { organizationId: orgId, type: 'push_subscription' },
        select: { id: true, data: true },
      }),
      db.settings.findUnique({
        where: { organizationId: orgId },
        select: { vapidPublicKey: true, vapidPrivateKeyEnc: true },
      }),
    ])

    if (subscriptions.length === 0) return { sent: 0, failed: 0 }
    const encPrivateKey = settings?.vapidPrivateKeyEnc
    if (!settings?.vapidPublicKey || !encPrivateKey) return { sent: 0, failed: 0 }

    const privateKey = decryptSecret(encPrivateKey)
    if (!privateKey) return { sent: 0, failed: 0 }

    const mod = (await import('web-push')) as unknown as {
      default?: typeof import('web-push')
    } & typeof import('web-push')
    const webpush = mod.default?.sendNotification ? mod.default : mod
    if (!webpush.sendNotification) return { sent: 0, failed: 0 }

    const vapidDetails = {
      subject: 'mailto:contacto@crm-albra.com',
      publicKey: settings.vapidPublicKey,
      privateKey,
    }

    let sent = 0
    let failed = 0
    const staleIds: string[] = []

    await Promise.allSettled(
      subscriptions.map(async (row) => {
        if (!row.data) {
          staleIds.push(row.id)
          return
        }
        let sub: PushSubscriptionLike
        try {
          sub = JSON.parse(row.data) as PushSubscriptionLike
        } catch {
          staleIds.push(row.id)
          return
        }
        if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
          staleIds.push(row.id)
          return
        }
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload), vapidDetails)
          sent++
        } catch (err) {
          failed++
          const statusCode = (err as { statusCode?: number })?.statusCode
          if (statusCode === 404 || statusCode === 410) staleIds.push(row.id)
        }
      })
    )

    if (staleIds.length > 0) {
      await db.notification.deleteMany({ where: { id: { in: staleIds } } })
    }
    return { sent, failed }
  } catch (err) {
    console.error('[push] sendPushToOrganization falló (no bloquea)', err)
    return { sent: 0, failed: 0 }
  }
}

/**
 * Crea la notificación in-app y dispara el push a los navegadores suscritos.
 * Reemplaza al db.notification.create directo en los puntos donde el equipo
 * DEBE enterarse rápido (handoff de canal: el cliente pide un humano).
 */
export async function notifyOrganization(
  orgId: string,
  notification: { type: string; title: string; body: string; data?: string }
): Promise<void> {
  await db.notification.create({
    data: {
      organizationId: orgId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
    },
  })
  await sendPushToOrganization(orgId, {
    title: notification.title,
    body: notification.body,
    url: '/inbox',
    tag: notification.type,
  })
}
