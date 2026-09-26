import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET /api/nicho — PÚBLICO. Solo campos de branding (sin secretos, sin raw completo).
 *   Devuelve alias snake_case + camelCase porque el frontend lee `branding_name`.
 *   Incluye además terminology / reglas_oro / negociacion (config no sensible del
 *   agente) porque el formulario "Negocio" de settings-page.tsx los muestra.
 * PUT /api/nicho — requireAdmin (cierra el fallo P0 de la auditoría: antes cualquiera podía escribir).
 */

const DEFAULT_RAW = {
  terminology: { rol_primario: 'Cliente', rol_secundario: 'Asesor', evento: 'Cita', evento_plural: 'Citas' },
  reglas_oro: [] as string[],
  negociacion: { descuento_maximo: 10, estrategia: '' },
}

async function loadOrCreate(orgId: string) {
  const config = await db.nichoConfig.findUnique({ where: { organizationId: orgId } })
  if (config) return config
  return db.nichoConfig.create({ data: { organizationId: orgId } })
}

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

export async function GET(req: NextRequest) {
  return handle(async () => {
    const url = new URL(req.url)
    const slug = url.searchParams.get('org') // opcional: resolver org por slug (multi-tenant público)
    const org = slug
      ? await db.organization.findUnique({ where: { slug }, select: { id: true } })
      : null
    // Sin sesión y sin slug: sirve la primera organización activa (preview single-tenant)
    const orgId =
      org?.id ||
      (await db.organization.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id
    if (!orgId) return json({ error: 'Organización no encontrada' }, { status: 404 })

    const config = await loadOrCreate(orgId)
    const raw = parseRaw(config.raw)

    // SOLO branding público + config no sensible del agente (nunca secrets ni raw completo)
    return json({
      brandingName: config.brandingName,
      branding_name: config.brandingName,
      rubro: config.rubro,
      personality: config.personality,
      tone: config.tone,
      tone_label: config.tone,
      workingHours: config.workingHours,
      working_hours: config.workingHours,
      autoReplyEnabled: config.autoReplyEnabled,
      auto_reply: config.autoReplyEnabled,
      services: config.services,
      faqs: config.faqs,
      terminology: raw.terminology,
      reglas_oro: raw.reglas_oro,
      negociacion: raw.negociacion,
    })
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
    const auth = requireAdmin(req) // P0: escritura solo para admins/owner
    const body = (await req.json().catch(() => ({}))) as NichoBody
    await loadOrCreate(auth.orgId)

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
