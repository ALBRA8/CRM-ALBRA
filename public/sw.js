/**
 * Service Worker de CRM ALBRA (Fase 4 — PWA + push + offline).
 *
 * v1: SOLO web-push + manejo de clics de notificación.
 * v2 (actual): añade soporte offline MÍNIMO y seguro:
 *  - Precache SOLO de /offline.html + iconos (nada de assets hashed de Next:
 *    son inestables entre builds).
 *  - activate borra cualquier cache viejo cuyo nombre !== CACHE_VERSION.
 *  - fetch SOLO para request.mode === 'navigate' (documentos): network-first con
 *    timeout corto (AbortSignal.timeout). Si la red responde, se devuelve TAL CUAL
 *    y NUNCA se cachea: el HTML de una SPA autenticada es por usuario y debe
 *    estar siempre fresco. Si la red falla o expira → offline.html precacheado.
 *  - NUNCA intercepta: /api/** (pasa directo a red, sin fallback offline),
 *    métodos distintos de GET, ni requests cross-origin. Todo lo demás pasa sin
 *    respondWith (riesgo cero para la API y los assets).
 *
 * Push: los handlers push y notificationclick de v1 quedan intactos (misma
 * conducta), igual que skipWaiting + clients.claim para actualizar sin fricción.
 */

const CACHE_VERSION = 'albra-v2'
const OFFLINE_URL = '/offline.html'
const PRECACHE_URLS = [OFFLINE_URL, '/icon-192.png', '/icon-512.png']
const NAVIGATE_TIMEOUT_MS = 4500

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await self.caches.open(CACHE_VERSION)
        await cache.addAll(PRECACHE_URLS)
      } catch {
        // Precache best-effort: si falla (p. ej. sin soporte de caches),
        // el push y la app siguen funcionando igual que en v1.
      }
    })()
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await self.caches.keys()
        await Promise.all(
          names.filter((name) => name !== CACHE_VERSION).map((name) => self.caches.delete(name))
        )
      } catch {
        // Limpieza best-effort: nunca debe romper la activación.
      }
      await self.clients.claim()
    })()
  )
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

self.addEventListener('fetch', (event) => {
  try {
    const request = event.request

    // Nunca interceptar métodos distintos de GET.
    if (request.method !== 'GET') return

    const url = new URL(request.url)

    // Nunca interceptar cross-origin (CDNs, proveedores externos, etc.).
    if (url.origin !== self.location.origin) return

    // /api/** pasa SIEMPRE directo a red: sin caché y sin fallback offline.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return

    // Solo documentos (navegación). Assets y demás pasan sin tocar (sin respondWith).
    if (request.mode !== 'navigate') return

    event.respondWith(handleNavigate(request))
  } catch {
    // Ante cualquier error inesperado, dejar pasar la request sin interceptar.
  }
})

/**
 * Network-first con timeout corto para documentos.
 * Nota: fetch(navigateRequest, init) es seguro — la spec convierte el modo
 * 'navigate' a 'same-origin' al reconstruir la request con init (no lanza).
 */
async function handleNavigate(request) {
  try {
    const init =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(NAVIGATE_TIMEOUT_MS) }
        : undefined
    return await fetch(request, init)
  } catch {
    // Red caída o timeout → página offline precacheada. El HTML de la SPA
    // autenticada NUNCA se cachea (contenido por usuario, siempre fresco).
    try {
      const cache = await self.caches.open(CACHE_VERSION)
      const offline = await cache.match(OFFLINE_URL)
      if (offline) return offline
    } catch {
      // Sin soporte de caches o fallo de lectura → último recurso mínimo.
    }
    return new Response(
      '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sin conexión – CRM ALBRA</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f1f5f9;font-family:system-ui,sans-serif;color:#334155">Sin conexión. Revisa tu red e intenta de nuevo.</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}
