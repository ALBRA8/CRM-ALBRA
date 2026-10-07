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
 * SEGURIDAD (auditoría Antigravity, críticos #2/#3/#4 + hardening pre-venta):
 *  - requireAuth (JWT) en TODOS los métodos: antes los GET/POST estaban abiertos y
 *    cualquiera podía leer conversaciones o enviar mensajes sin iniciar sesión.
 *  - El secreto server-to-server (INTERNAL_API_SECRET) vive solo en el servidor;
 *    no hay fallback hardcodeado y el frontend jamás lo conoce.
 *  - En /connect se inyecta orgId de la sesión JWT → el daemon vincula la sesión
 *    de WhatsApp a la organización correcta (aislamiento multi-tenant).
 *
 * FAIL-CLOSED (auditoría pre-venta P0): la propiedad de la sesión se VERIFICA
 * contra el daemon y la duda NUNCA se resuelve a favor del llamador:
 *
 *   linkedOrgId === authOrgId          → permitir
 *   linkedOrgId !== authOrgId          → DENEGAR (403)
 *   linkedOrgId no disponible          → DENEGAR (403)  [excepto /connect y
 *      consultas de estado cuando el daemon VERIFICÓ explícitamente que NO hay
 *      sesión vinculada: sin sesión no hay nada que fugar]
 *   error al consultar ownership       → DENEGAR (403)  [daemon caído, timeout,
 *      status no-ok, respuesta ambigua]
 *
 * Si el daemon no está corriendo NO se simula estado: la operación se deniega
 * con 403/503 (respuestas vacías falsas ocultaban el fallo al operador).
 */

const DAEMON_URL = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET
const TIMEOUT_MS = 3000

const ALLOWED_GET = [/^\/status$/, /^\/qr$/, /^\/conversations$/, /^\/conversations\/[\w@.:-]+$/]
const ALLOWED_POST = ['/connect', '/disconnect', '/send', '/logout']
const ALLOWED_PUT = [/^\/conversations\/[\w@.:-]+$/]

/**
 * GUARD MULTI-TENANT FAIL-CLOSED (auditoría pre-venta P0): el daemon es UNA
 * sola sesión de WhatsApp vinculada a UNA organización. Un usuario autenticado
 * de la org B NO puede leer/enviar/desconectar/conectar la sesión de la org A.
 * Si la propiedad NO puede verificarse (daemon caído, timeout, status no-ok,
 * respuesta ambigua) la operación se DENIEGA — "no pude comprobarlo" jamás se
 * interpreta como "no hay organización vinculada".
 */
type OwnershipVerdict = 'SAME_ORG' | 'UNLINKED' | 'OTHER_ORG' | 'UNKNOWN'

async function resolveOwnership(authOrgId: string): Promise<OwnershipVerdict> {
  let res: Response
  try {
    res = await fetch(`${DAEMON_URL}/status`, {
      headers: daemonHeaders(),
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    })
  } catch {
    return 'UNKNOWN' // daemon caído / timeout / INTERNAL_API_SECRET ausente → DENIED
  }
  if (!res.ok) return 'UNKNOWN' // error consultando ownership → DENIED
  let j: { orgLinked?: unknown; linkedOrgId?: unknown }
  try {
    j = (await res.json()) as { orgLinked?: unknown; linkedOrgId?: unknown }
  } catch {
    return 'UNKNOWN' // respuesta no-JSON → DENIED
  }
  if (typeof j.orgLinked !== 'boolean') return 'UNKNOWN' // ambigua → DENIED
  if (!j.orgLinked) return 'UNLINKED' // daemon VERIFICÓ explícitamente: no hay sesión
  if (typeof j.linkedOrgId !== 'string' || !j.linkedOrgId) return 'UNKNOWN'
  return j.linkedOrgId === authOrgId ? 'SAME_ORG' : 'OTHER_ORG'
}

const DENY_MSG: Record<Exclude<OwnershipVerdict, 'SAME_ORG'>, string> = {
  OTHER_ORG: 'Esta sesión de WhatsApp pertenece a otra organización',
  UNLINKED: 'No hay sesión de WhatsApp vinculada: conéctala primero desde tu organización',
  UNKNOWN: 'DENIED: no se pudo verificar la propiedad de la sesión de WhatsApp (daemon no disponible o error de estado). Operación denegada por seguridad (fail-closed)',
}

function deny(v: Exclude<OwnershipVerdict, 'SAME_ORG'>): NextResponse {
  return json({ error: DENY_MSG[v] }, { status: 403 })
}

/**
 * Política por operación:
 *   connect → SAME_ORG | UNLINKED (vinculación inicial; el primero que escanea
 *             el QR vincula la sesión a su org — después, todos los demás: 403)
 *   view    (status/qr) → SAME_ORG | UNLINKED (con UNLINKED no hay nada que
 *             filtrar; con OTHER_ORG se deniega para NO filtrar teléfono/org)
 *   operate (send/disconnect/logout/conversations/PUT) → SOLO SAME_ORG
 */
type Op = 'connect' | 'view' | 'operate'

function sessionGate(v: OwnershipVerdict, op: Op): NextResponse | null {
  if (v === 'SAME_ORG') return null
  if (op !== 'operate' && v === 'UNLINKED') return null
  return deny(v as Exclude<OwnershipVerdict, 'SAME_ORG'>)
}

function daemonHeaders(): Record<string, string> {
  // El secreto interno solo se usa server-to-server. Si falta, la config está rota
  // y fallamos con error descriptivo (nunca con una clave hardcodeada).
  if (!INTERNAL_API_SECRET) {
    throw new Error('INTERNAL_API_SECRET no configurado en el servidor (.env). El proxy al daemon de WhatsApp no puede autenticarse.')
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${INTERNAL_API_SECRET}` }
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
    // Daemon cayó DESPUÉS de verificar ownership: error honesto, no datos falsos
    return json({ error: 'Daemon de WhatsApp no disponible' }, { status: 503 })
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
    const auth = requireAuth(req)
    const op: Op = clean === '/status' || clean === '/qr' ? 'view' : 'operate'
    const denied = sessionGate(await resolveOwnership(auth.orgId), op)
    if (denied) return denied
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
      // Multi-tenant fail-closed: la sesión se vincula a la org del JWT; si el
      // daemon ya está vinculado a OTRA org o NO puede verificarse, se deniega.
      const op: Op = path === '/connect' ? 'connect' : 'operate'
      const denied = sessionGate(await resolveOwnership(auth.orgId), op)
      if (denied) return denied
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
      // Daemon caído: fail-closed — ni éxito simulado ni estado falso
      return json({ success: false, error: 'Daemon de WhatsApp no disponible' }, { status: 503 })
    }
  })
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as ProxyBody
    const path = String(body.path || '')
    if (!ALLOWED_PUT.some((re) => re.test(path))) {
      return json({ error: `path no permitido: ${path || '(vacío)'}` }, { status: 400 })
    }
    const denied = sessionGate(await resolveOwnership(auth.orgId), 'operate')
    if (denied) return denied
    try {
      const { path: _path, ...updates } = body
      // El daemon filtra el UPDATE por esta organización (defensa en profundidad)
      const res = await fetch(`${DAEMON_URL}${path}`, {
        method: 'PUT',
        headers: daemonHeaders(),
        body: JSON.stringify({ ...updates, orgId: auth.orgId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
      })
    } catch {
      return json({ success: false, error: 'Daemon de WhatsApp no disponible' }, { status: 503 })
    }
  })
}
