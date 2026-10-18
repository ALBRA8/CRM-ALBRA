import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { can } from '@/lib/rbac'
import { lookupApiKey } from '@/lib/api-keys'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { CRM_ACTIONS, crmActionsCatalog, executeCrmAction } from '@/lib/capabilities/crm-actions'

/**
 * POST /api/crm/actions — CONTRATO DEL CHALECO CRM para hosts (REST).
 *
 * Ejecuta una acción de negocio del catálogo CRM_ACTIONS con validación zod,
 * permisos RBAC y aislamiento multi-tenant. Sustituye al extinto /api/chat
 * (agente propietario): la inteligencia que decide QUÉ acción ejecutar vive
 * ahora en el host que consume este contrato.
 *
 * Autenticación (dos modos equivalentes):
 *  - Usuario de la app:  Authorization: Bearer <JWT>  → permisos por rol (RBAC)
 *  - Host programático:  Authorization: Bearer albra_… (API key de la org,
 *    la misma que usa el servidor MCP) → acceso completo a las acciones de la org
 *
 * Body:  { action: string, params?: object }
 * Resp:  { ok, summary, data?, clientId? }
 * Errores: 400 params/acción inválida · 401 sin auth · 403 permiso/aislamiento
 *
 * GET  → catálogo auto-descriptivo de acciones (kind, permiso, params, docs).
 */

function bearerOf(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null
}

/** Resuelve { orgId, userId, role } desde JWT de usuario o API key de org. */
async function resolveCaller(req: NextRequest): Promise<{ orgId: string; userId: string | null; role: string } | null> {
  const bearer = bearerOf(req)
  if (!bearer) return null

  // 1) ¿API key de organización (host programático)?
  if (bearer.startsWith('albra_')) {
    const key = await lookupApiKey(bearer)
    if (!key || !key.orgActive) return null
    try {
      await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    } catch {
      // telemetría best-effort
    }
    return { orgId: key.organizationId, userId: null, role: 'api-key' }
  }

  // 2) JWT de usuario de la app
  try {
    const auth = requireAuth(req)
    return { orgId: auth.orgId, userId: auth.userId, role: auth.role }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const caller = await resolveCaller(req)
    if (!caller) return json({ error: 'No autenticado' }, { status: 401 })
    return json({
      contract: 'crm-actions/v1',
      description: 'Acciones de negocio del CRM ejecutables por un host autorizado (chaleco CRM).',
      actions: crmActionsCatalog(),
    })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { action?: string; params?: Record<string, unknown> }
    requireFields(body as unknown as Record<string, unknown>, ['action'])

    const caller = await resolveCaller(req)
    if (!caller) return json({ error: 'No autenticado' }, { status: 401 })

    const action = String(body.action)
    const meta = CRM_ACTIONS[action]
    if (!meta) {
      return json({ error: `Acción desconocida: ${action}`, available: Object.keys(CRM_ACTIONS) }, { status: 400 })
    }

    // RBAC: una API key de org tiene las capacidades del negocio (es el token
    // de la organización); un usuario pasa por su rol.
    if (caller.role !== 'api-key' && !can(caller.role, meta.permiso)) {
      return json({ error: `Sin permiso para esta acción (${meta.permiso})` }, { status: 403 })
    }

    // Validación del contrato de la acción ANTES de tocar la BD.
    let params = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>
    const parsed = meta.schema.safeParse(params)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue?.path?.length ? ` (${issue.path.join('.')})` : ''
      return json({ error: `Parámetro inválido en ${action}${where}: ${issue?.message ?? 'formato incorrecto'}` }, { status: 400 })
    }
    params = parsed.data as Record<string, unknown>

    const result = await executeCrmAction(caller.orgId, caller.userId, action, params, 'crm-api')
    return json(result, { status: result.ok ? 200 : 400 })
  })
}
