'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

/**
 * Registro del Service Worker + suscripción web-push (Fase 4).
 *
 * Montado en AppShell SOLO con sesión iniciada. Comportamiento respetuoso:
 *  - Si el navegador no soporta SW/Push → no hace nada.
 *  - Permiso ya concedido → suscribe silenciosamente (la API dedupe por endpoint).
 *  - Permiso 'default' → UN toast con botón "Activar" cada 7 días (localStorage),
 *    nunca ventanas emergentes automáticas ni acoso.
 *  - Permiso 'denied' → silencio para siempre.
 */

const ASK_FLAG = 'albra-push-asked-at'
const ASK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const output = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

async function subscribePush(registration: ServiceWorkerRegistration, publicKey: string): Promise<void> {
  const existing = await registration.pushManager.getSubscription()
  const sub =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
  await api.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
}

export function PushManager() {
  useEffect(() => {
    let cancelled = false

    async function run() {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return

      try {
        // 1) Registrar el SW (idempotente)
        const registration = await navigator.serviceWorker.register('/sw.js')

        // 2) Pedir la clave pública VAPID (pública; si falla, push no disponible)
        const vapid = (await fetch('/api/push/vapid').then((r) => (r.ok ? r.json() : null))) as {
          publicKey?: string
        } | null
        if (!vapid?.publicKey || cancelled) return

        // 3a) Concedido → suscribir en silencio
        if (Notification.permission === 'granted') {
          await subscribePush(registration, vapid.publicKey)
          return
        }

        // 3b) Denegado → silencio
        if (Notification.permission === 'denied') return

        // 3c) Sin decidir → un toast cada 7 días, con gesto del usuario
        const last = Number(localStorage.getItem(ASK_FLAG) || 0)
        if (Date.now() - last < ASK_INTERVAL_MS) return

        toast('Recibe avisos de clientes en tiempo real', {
          description: 'Activa las notificaciones para enterarte cuando alguien pida hablar contigo.',
          duration: 10000,
          action: {
            label: 'Activar',
            onClick: async () => {
              localStorage.setItem(ASK_FLAG, String(Date.now()))
              const perm = await Notification.requestPermission()
              if (perm === 'granted') {
                try {
                  await subscribePush(registration, vapid.publicKey as string)
                  toast.success('Notificaciones activadas')
                } catch {
                  toast.error('No se pudo activar el push en este navegador')
                }
              }
            },
          },
        })
        localStorage.setItem(ASK_FLAG, String(Date.now()))
      } catch {
        // Push es best-effort: cualquier fallo se ignora silenciosamente
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
