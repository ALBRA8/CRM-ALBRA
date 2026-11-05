import type { NextRequest } from 'next/server'
import { requireAdmin, getAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { logSecurityEvent } from '@/lib/security-log'

/**
 * GET /api/nicho — configuración "Negocio" del nicho.
 *
 * CONTRATO P0.3 (selección de organización):
 *
 * 1) SOLICITUD AUTENTICADA (cualquier rol con sesión válida):
 *    La organización viene EXCLUSIVAMENTE del JWT. Cualquier `?org=`/slug/
 *    organizationId enviado por el cliente se IGNORA y se registra como evento
 *    de seguridad (la UI legítima nunca los envía). Devuelve la configuración
 *    COMPLETA de la propia org (branding, terminology, reglas_oro, negociacion,
 *    servicios, faqs) — son sus datos, jamás los de otra organización.
 *    LECTURA PURA: GET nunca crea filas.
 *
 * 2) SOLICITUD ANÓNIMA (pública legítima, alcance estrictamente limitado):
 *    SOLO con identificador público explícito `?org=<slug>` (formato validado).
 *    Expone ÚNICAMENTE los campos de marca pública autorizados:
 *    brandingName, rubro, tone, workingHours, terminology, services, faqs.
 *    NO expone: personality, autoReplyEnabled, handoffKeywords (config interna
 *    del agente), reglas_oro y negociacion (táctica comercial sensible: tope de
 *    descuento, estrategia), ni el raw completo.
 *    - Rate limit 30 req/min por IP (anti-enumeración de slugs) → 429.
 *    - Slug inválido → 400; slug desconocido u org inactiva → 404 genérico
 *      (sin oráculo de existencia); ambos registrados como eventos de seguridad.
 *    - Sin `?org=` → 401 (se eliminó el fallback "primera organización activa"
 *      que exponía el tenant equivocado a anónimos).
 *    - JAMÁS escribe en BD (antes un GET anónimo podía CREAR NichoConfig).
 *
 * PUT /api/nicho — escritura: requireAdmin. La organización viene del JWT;
 * los identificadores de org en el body se ignoran por construcción (el
 * handler jamás los lee) y se registran si aparecen.
 */

const DEFAULT_RAW = {
  terminology: { rol_primario: 'Cliente', rol_secundario: 'Asesor', evento: 'Cita', evento_plural: 'Citas' },
  reglas_oro: [] as string[],
  negociacion: { descuento_maximo: 10, estrategia: '' },
}

/** Slug público válido (mismo vocabulario que genera slugify). */
const PUBLIC_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const PUBLIC_RATE_LIMIT = 30
const PUBLIC_RATE_WINDOW_MS = 60_000

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function parseRaw(raw: string | null): Record<string, unknown> {
  if (!raw) return { ...DEFAULT_RAW }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      ...DEFAULT_RAW,
      ...parsed,
      terminology: { ...DEFAULT_RAW.terminology, ...((parsed.terminology as object) || {}) },
      negociacion: { ...DEFAULT_RAW.negociacion, ...((parsed.negociacion as object) || {}) },
    }
  } catch {
    return { ...DEFAULT_RAW }
  }
}

function parseJsonArray(input: string | null | undefined): unknown[] {
  if (!input) return []
  try {
    const parsed = JSON.parse(input)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Payload COMPLETO para la organización autenticada (sus propios datos). */
function fullPayload(config: {
  brandingName: string
  rubro: string
  personality: string
  tone: string | null
  workingHours: string | null
  autoReplyEnabled: boolean
  services: string | null
  faqs: string | null
  raw: string | null
} | null) {
  const raw = parseRaw(config?.raw ?? null)
  return {
    brandingName: config?.brandingName ?? 'CRM ALBRA',
    branding_name: config?.brandingName ?? 'CRM ALBRA',
    rubro: config?.rubro ?? 'Servicios Profesionales',
    personality: config?.personality ?? '',
    tone: config?.tone,
    tone_label: config?.tone,
    workingHours: config?.workingHours,
    working_hours: config?.workingHours,
    autoReplyEnabled: config?.autoReplyEnabled ?? true,
    auto_reply: config?.autoReplyEnabled ?? true,
    services: config?.services,
    faqs: config?.faqs,
    terminology: raw.terminology,
    reglas_oro: raw.reglas_oro,
    negociacion: raw.negociacion,
  }
}

/** Payload PÚBLICO anónimo: solo marca autorizada (sin táctica comercial ni config interna). */
function publicPayload(config: {
  brandingName: string
  rubro: string
  tone: string | null
  workingHours: string | null
  services: string | null
  faqs: string | null
  raw: string | null
} | null) {
  const raw = parseRaw(config?.raw ?? null)
  return {
    brandingName: config?.brandingName ?? 'CRM ALBRA',
    branding_name: config?.brandingName ?? 'CRM ALBRA',
    rubro: config?.rubro ?? 'Servicios Profesionales',
    tone: config?.tone,
    tone_label: config?.tone,
    workingHours: config?.workingHours,
    working_hours: config?.workingHours,
    terminology: raw.terminology,
    services: parseJsonArray(config?.services),
    faqs: parseJsonArray(config?.faqs),
  }
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const url = new URL(req.url)
    const slugParam = url.searchParams.get('org')
    const auth = getAuth(req)

    // ---------- 1) Autenticado: la organización SOLO del JWT ----------
    if (auth) {
      if (slugParam) {
        // Parámetro controlado por el cliente → ignorado SIEMPRE; se deja constancia.
        logSecurityEvent('nicho.org_param_ignorado', { userId: auth.userId, orgId: auth.orgId, solicitado: slugParam })
      }
      const config = await db.nichoConfig.findUnique({ where: { organizationId: auth.orgId } })
      return json(fullPayload(config), { headers: NO_STORE })
    }

    // ---------- 2) Anónimo: identificador público explícito, rate-limited ----------
    const ip = clientIp(req)
    const rl = rateLimit(`nicho:${ip}`, PUBLIC_RATE_LIMIT, PUBLIC_RATE_WINDOW_MS)
    if (!rl.ok) {
      logSecurityEvent('nicho.rate_limit_alcanzado', { ip })
      return json({ error: 'Demasiadas solicitudes. Intenta más tarde.' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } })
    }

    if (!slugParam) {
      return json({ error: 'Sesión requerida. Para datos públicos de marca usa ?org=<slug>.' }, { status: 401, headers: NO_STORE })
    }
    if (!PUBLIC_SLUG_RE.test(slugParam)) {
      logSecurityEvent('nicho.slug_invalido', { ip, valor: slugParam })
      return json({ error: 'Parámetro org inválido' }, { status: 400, headers: NO_STORE })
    }

    const org = await db.organization.findUnique({ where: { slug: slugParam }, select: { id: true, isActive: true } })
    if (!org?.isActive) {
      // 404 genérico: sin diferencia entre "no existe" e "inactiva" (sin oráculo).
      logSecurityEvent('nicho.slug_desconocido', { ip, slug: slugParam })
      return json({ error: 'Organización no encontrada' }, { status: 404, headers: NO_STORE })
    }

    // LECTURA pura: el GET anónimo jamás crea filas (antes podía crear NichoConfig).
    const config = await db.nichoConfig.findUnique({ where: { organizationId: org.id } })
    return json(publicPayload(config), { headers: NO_STORE })
  })
}

interface NichoBody {
  branding_name?: string
  brandingName?: string
  rubro?: string
  personality?: string
  tone?: string
  tone_label?: string
  workingHours?: string
  working_hours?: string
  autoReplyEnabled?: boolean
  auto_reply?: boolean
  services?: unknown
  faqs?: unknown
  handoffKeywords?: unknown
  terminology?: Record<string, unknown>
  reglas_oro?: string[]
  negociacion?: Record<string, unknown>
  extra?: Record<string, unknown>
  [key: string]: unknown
}

function toJsonArrayString(input: unknown): string | null {
  if (input === undefined || input === null) return null
  let list: unknown[] = []
  if (Array.isArray(input)) list = input
  else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) list = parsed
      else return null
    } catch {
      list = input.split('\n').map((s) => s.trim()).filter(Boolean)
    }
  } else return null
  return JSON.stringify(list.slice(0, 50))
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req) // P0: escritura solo para admins/owner; org SOLO del JWT
    const body = (await req.json().catch(() => ({}))) as NichoBody

    // P0.3: identificadores de organización enviados por el cliente no se leen
    // nunca; si aparecen, se registra y se ignora.
    if ('organizationId' in body || 'org' in body || 'slug' in body) {
      logSecurityEvent('nicho.org_param_en_put_ignorado', { userId: auth.userId, orgId: auth.orgId })
    }

    const current = await db.nichoConfig.findUnique({ where: { organizationId: auth.orgId } })
    const raw = parseRaw(current?.raw || null)

    const brandingName = String(body.branding_name ?? body.brandingName ?? current?.brandingName ?? 'CRM ALBRA').slice(0, 120)
    const rubro = String(body.rubro ?? current?.rubro ?? 'Servicios Profesionales').slice(0, 160)
    const personality = String(body.personality ?? current?.personality ?? '').slice(0, 500)
    const tone = body.tone ?? body.tone_label ?? current?.tone ?? null
    const workingHours = body.workingHours ?? body.working_hours ?? current?.workingHours ?? null
    const autoReplyEnabled =
      typeof body.autoReplyEnabled === 'boolean' ? body.autoReplyEnabled : typeof body.auto_reply === 'boolean' ? body.auto_reply : current?.autoReplyEnabled ?? true

    if (body.terminology && typeof body.terminology === 'object') {
      raw.terminology = { ...(raw.terminology as Record<string, unknown>), ...body.terminology }
    }
    if (Array.isArray(body.reglas_oro)) raw.reglas_oro = body.reglas_oro.map((r) => String(r).slice(0, 300)).slice(0, 20)
    if (body.negociacion && typeof body.negociacion === 'object') {
      raw.negociacion = { ...(raw.negociacion as Record<string, unknown>), ...body.negociacion }
    }

    const config = await db.nichoConfig.upsert({
      where: { organizationId: auth.orgId },
      update: {
        brandingName,
        rubro,
        personality: personality || 'Profesional, empático y orientado a resultados',
        tone: tone ? String(tone).slice(0, 200) : null,
        workingHours: workingHours ? String(workingHours).slice(0, 200) : null,
        autoReplyEnabled,
        ...(body.services !== undefined ? { services: toJsonArrayString(body.services) } : {}),
        ...(body.faqs !== undefined ? { faqs: toJsonArrayString(body.faqs) } : {}),
        ...(body.handoffKeywords !== undefined ? { handoffKeywords: toJsonArrayString(body.handoffKeywords) } : {}),
        raw: JSON.stringify(raw),
      },
      create: {
        organizationId: auth.orgId,
        brandingName,
        rubro,
        personality: personality || 'Profesional, empático y orientado a resultados',
        tone: tone ? String(tone).slice(0, 200) : null,
        workingHours: workingHours ? String(workingHours).slice(0, 200) : null,
        autoReplyEnabled,
        services: toJsonArrayString(body.services),
        faqs: toJsonArrayString(body.faqs),
        handoffKeywords: toJsonArrayString(body.handoffKeywords),
        raw: JSON.stringify(raw),
      },
    })

    const { auditAndTimeline } = await import('@/lib/api-helpers')
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'nicho_config',
      entityId: config.id,
      details: { brandingName, rubro },
    })

    return json({ success: true, config: { brandingName: config.brandingName, rubro: config.rubro, autoReplyEnabled: config.autoReplyEnabled } })
  })
}
