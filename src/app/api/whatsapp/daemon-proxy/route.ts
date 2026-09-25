import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handle, json } from '@/lib/api-helpers'
import { requireAuth } from '@/lib/auth'

/**
 * Proxy al daemon de WhatsApp (Baileys) en http://localhost:3002 con timeout de 3s.
 * El frontend SIEMPRE pasa por aquí (nunca al puerto 3002 directamente):
 *   GET  /api/whatsapp/daemon-proxy?path=/status|/qr|/conversations|/conversations/:id
 *   POST /api/whatsapp/daemon-proxy  { path: '/connect' | '/disconnect' | '/send', ... }
 *   PUT  /api/whatsapp/daemon-proxy  { path: '/conversations/:id', ... }
 *
 * SEGURIDAD (auditoría Antigravity, críticos #2/#3/#4):
 *  - requireAuth (JWT) en TODOS los métodos: antes los GET/POST estaban abiertos y
 *    cualquiera podía leer conversaciones o enviar mensajes sin iniciar sesión.
 *  - El secreto server-to-server (INTERNAL_API_SECRET) vive solo en el servidor;
 *    no hay fallback hardcodeado y el frontend jamás lo conoce.
 *  - En /connect se inyecta orgId de la sesión JWT → el daemon vincula la sesión
 *    de WhatsApp a la organización correcta (aislamiento multi-tenant).
 *
 * Si el daemon no está corriendo → degradación elegante SIN error:
 *  - status  → { status: 'disconnected', phone: null, lastUpdate: null }
 *  - qr      → { status: 'disconnected', qr: null }
 *  - listas  → { conversations: [] } / array vacío
 */

const DAEMON_URL = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET
const TIMEOUT_MS = 3000

const ALLOWED_GET = [/^\/status$/, /^\/qr$/, /^\/conversations$/, /^\/conversations\/[\w@.:-]+$/]
const ALLOWED_POST = ['/connect', '/disconnect', '/send', '/logout']
const ALLOWED_PUT = [/^\/conversations\/[\w@.:-]+$/]

function daemonHeaders(): Record<string, string> {
  // El secreto interno solo se usa server-to-server. Si falta, la config está rota
  // y fallamos con error descriptivo (nunca con una clave hardcodeada).
  if (!INTERNAL_API_SECRET) {
    throw new Error('INTERNAL_API_SECRET no configurado en el servidor (.env). El proxy al daemon de WhatsApp no puede autenticarse.')
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${INTERNAL_API_SECRET}` }
}

function disconnectedStatus() {
  return { status: 'disconnected', phone: null, lastUpdate: null }
}

async function proxyGet(path: string): Promise<NextResponse> {
  try {
    const res = await fetch(`${DAEMON_URL}${path}`, {
      headers: daemonHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    })
  } catch {
    // Daemon apagado: respuestas por defecto según el path
    if (path.startsWith('/status')) return json(disconnectedStatus())
    if (path.startsWith('/qr')) return json({ status: 'disconnected', qr: null, qrText: null })
    return json({ conversations: [] })
  }
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    requireAuth(req)
    const path = new URL(req.url).searchParams.get('path') || '/status'
    const clean = path.startsWith('/') ? path : `/${path}`
    if (!ALLOWED_GET.some((re) => re.test(clean))) {
      return json({ error: `path no permitido: ${clean}` }, { status: 400 })
    }
    // Pasa el resto de query params (ej. ?path=/conversations?limit=50 → &limit=50)
    const rest = new URL(req.url)
    rest.searchParams.delete('path')
    const extra = rest.searchParams.toString()
    return proxyGet(clean + (extra ? `?${extra}` : ''))
  })
}

interface ProxyBody {
  path?: string
  [key: string]: unknown
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as ProxyBody
    const path = String(body.path || '/connect')
    if (!ALLOWED_POST.includes(path)) {
      return json({ error: `path no permitido: ${path}` }, { status: 400 })
    }
    try {
      // Multi-tenant: la sesión de WhatsApp se vincula a la org del JWT.
      // El frontend NO puede elegir otra organización.
      const payload = path === '/connect' ? { ...body, orgId: auth.orgId } : body
      const res = await fetch(`${DAEMON_URL}${path}`, {
        method: 'POST',
        headers: daemonHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
      })
    } catch {
      // Daemon apagado: no hay nada que conectar
      return json({ success: false, ...disconnectedStatus(), note: 'Daemon de WhatsApp no disponible' })
    }
  })
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as ProxyBody
    const path = String(body.path || '')
    if (!ALLOWED_PUT.some((re) => re.test(path))) {
      return json({ error: `path no permitido: ${path || '(vacío)'}` }, { status: 400 })
    }
    try {
      const { path: _path, ...updates } = body
      const res = await fetch(`${DAEMON_URL}${path}`, {
        method: 'PUT',
        headers: daemonHeaders(),
        body: JSON.stringify(updates),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
      })
    } catch {
      return json({ success: false, note: 'Daemon de WhatsApp no disponible' })
    }
  })
}
