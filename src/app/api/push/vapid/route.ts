import type { NextRequest } from 'next/server'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'

/**
 * GET /api/push/vapid — PÚBLICO: { publicKey } para suscribir el navegador.
 * Las claves VAPID se generan una vez y se comparten entre organizaciones
 * (el endpoint es público, sin contexto de org). La clave privada se guarda
 * cifrada con AES-256-GCM en Settings.vapidPrivateKeyEnc.
 */

async function ensureVapidKeys(): Promise<string | null> {
  // 1) ¿Ya existen claves?
  const existing = await db.settings.findFirst({ where: { vapidPublicKey: { not: null } }, select: { vapidPublicKey: true, vapidPrivateKeyEnc: true } })
  if (existing?.vapidPublicKey) {
    // Backfill: organizaciones nuevas reciben las mismas claves compartidas
    const orgs = await db.organization.findMany({ where: { isActive: true }, select: { id: true } })
    for (const org of orgs) {
      const settings = await db.settings.findUnique({ where: { organizationId: org.id } })
      if (!settings?.vapidPublicKey) {
        await db.settings.upsert({
          where: { organizationId: org.id },
          update: { vapidPublicKey: existing.vapidPublicKey, vapidPrivateKeyEnc: existing.vapidPrivateKeyEnc },
          create: { organizationId: org.id, vapidPublicKey: existing.vapidPublicKey, vapidPrivateKeyEnc: existing.vapidPrivateKeyEnc },
        })
      }
    }
    return existing.vapidPublicKey
  }

  // 2) Generar claves nuevas (web-push; degradación si no está instalado)
  try {
    const mod = (await import('web-push')) as unknown as {
      default?: { generateVAPIDKeys: () => { publicKey: string; privateKey: string } }
      generateVAPIDKeys?: () => { publicKey: string; privateKey: string }
    }
    const webpush = mod.default && 'generateVAPIDKeys' in mod.default ? mod.default : mod
    if (!webpush.generateVAPIDKeys) return null
    const keys = webpush.generateVAPIDKeys()

    const orgs = await db.organization.findMany({ where: { isActive: true }, select: { id: true } })
    for (const org of orgs) {
      await db.settings.upsert({
        where: { organizationId: org.id },
        update: { vapidPublicKey: keys.publicKey, vapidPrivateKeyEnc: encryptSecret(keys.privateKey) },
        create: { organizationId: org.id, vapidPublicKey: keys.publicKey, vapidPrivateKeyEnc: encryptSecret(keys.privateKey) },
      })
    }
    return keys.publicKey
  } catch (err) {
    console.error('[push/vapid] no se pudieron generar claves VAPID', err)
    return null
  }
}

export async function GET(_req: NextRequest) {
  return handle(async () => {
    const publicKey = await ensureVapidKeys()
    if (!publicKey) {
      return json({ error: 'Push no disponible: no se pudieron generar las claves VAPID' }, { status: 400 })
    }
    return json({ publicKey })
  })
}
