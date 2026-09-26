import type { MetadataRoute } from 'next'

/**
 * Manifest PWA (Fase 4). Next.js lo sirve en /manifest.webmanifest y lo
 * enlaza automáticamente en el <head>. Instalable desde el navegador móvil
 * y de escritorio; los iconos se generan del logo con sharp
 * (scripts/generate-pwa-icons.mjs).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CRM ALBRA',
    short_name: 'ALBRA',
    description: 'CRM con agente de IA y WhatsApp, Telegram e Instagram para tu negocio',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#059669',
    lang: 'es',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
