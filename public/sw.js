/**
 * Service Worker de CRM ALBRA (Fase 4 — PWA + push).
 *
 * Alcance v1: SOLO web-push + manejo de clics de notificación.
 * Sin cache de assets (la app ya es rápida y un cache obsoleto sería peor;
 * el caché offline llegará cuando el producto lo pida, con estrategia
 * network-first + fallback). skipWaiting + clients.claim para actualizar
 * sin fricción.
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = { title: 'CRM ALBRA', body: 'Tienes una novedad en tu CRM', url: '/dashboard' }
  try {
    if (event.data) {
      const parsed = event.data.json()
      data = { ...data, ...parsed }
    }
  } catch {
    if (event.data) data.body = event.data.text() || data.body
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'albra',
      renotify: true,
      data: { url: data.url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          client.postMessage({ type: 'NAVIGATE', url })
          return
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
