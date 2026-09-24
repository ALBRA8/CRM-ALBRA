import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { handle, json } from '@/lib/api-helpers'

/**
 * Proxy al daemon de WhatsApp (Baileys) en http://localhost:3002 con timeout de 3s.
 * El frontend llama /api/whatsapp/daemon-proxy?path=/status|/qr|/conversations|/conversations/:id
 * y POST con body { path: '/connect' | '/disconnect' | '/send', ... }.
 *
 * Si el daemon no está corriendo → degradación elegante SIN error:
 *  - status  → { status: 'disconnected', phone: null, lastUpdate: null }
 *  - qr      → { status: 'disconnected', qr: null }
 *  - listas  → { conversations: [] } / array vacío
 */

const DAEMON_URL = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'
const TIMEOUT_MS = 3000

const ALLOWED_GET = [/^\/status$/, /^\/qr$/, /^\/conversations$/, /^\/conversations\/[\w@.:-]+$/]
const ALLOWED_POST = ['/connect', '/disconnect', '/send', '/logout']

function disconnectedStatus() {
  return { status: 'disconnected', phone: null, lastUpdate: null }
}

async function proxyGet(path: string): Promise<NextResponse> {
  try {
    const res = await fetch(`${DAEMON_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
    const text = await res.text()
    return new NextResponse(text, {
      status: 200,
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
    const body = (await req.json().catch(() => ({}))) as ProxyBody
    const path = String(body.path || '/connect')
    if (!ALLOWED_POST.includes(path)) {
      return json({ error: `path no permitido: ${path}` }, { status: 400 })
    }
    try {
      const res = await fetch(`${DAEMON_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      return new NextResponse(text, {
        status: 200,
        headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
      })
    } catch {
      // Daemon apagado: no hay nada que conectar
      return json({ success: false, ...disconnectedStatus(), note: 'Daemon de WhatsApp no disponible' })
    }
  })
}
