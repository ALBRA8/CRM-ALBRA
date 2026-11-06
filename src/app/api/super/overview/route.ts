import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth'
import { APP_VERSION } from '@/lib/version'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json } from '../../_lib/shared'

/**
 * GET /api/super/overview — plano de control multi-organización (solo superadmin).
 *
 * ÚNICO lugar de la app que consulta la base de datos SIN filtrar por
 * organizationId, siempre detrás de requireSuperAdmin(). Devuelve:
 *  - stats: conteos globales de la plataforma.
 *  - organizations: todas las organizaciones con sus conteos por entidad.
 *  - users: todos los usuarios con su organización y rol (usuarios clave).
 *  - catalogs: catálogo de productos/servicios por organización.
 *  - systems: salud de los 4 servicios del ecosistema ALBRA (CRM, daemon
 *    WhatsApp :3002, WHATSPOWER :3003, ULTRA :3004). Los secretos NUNCA
 *    salen en la respuesta: solo indicadores booleanos de configuración.
 *  - integrations: estado de los puentes entre capas (booleanos, no valores).
 */

interface SystemHealth {
  id: string
  name: string
  role: string
  url: string
  status: 'online' | 'offline' | 'degraded'
  latencyMs: number | null
  detail: Record<string, unknown>
}

async function fetchJson(url: string, opts: RequestInit = {}, ms = 2500): Promise<unknown> {
  const res = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(ms),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function probe(
  id: string,
  name: string,
  role: string,
  url: string,
  fn: () => Promise<Record<string, unknown>>
): Promise<SystemHealth> {
  const started = Date.now()
  try {
    const detail = await fn()
    return { id, name, role, url, status: 'online', latencyMs: Date.now() - started, detail }
  } catch (err) {
    return {
      id,
      name,
      role,
      url,
      status: 'offline',
      latencyMs: null,
      detail: { error: err instanceof Error ? err.message : 'sin respuesta' },
    }
  }
}

async function checkSystems(crmDbOk: boolean): Promise<SystemHealth[]> {
  const daemonUrl = process.env.WHATSAPP_DAEMON_URL || process.env.WA_DAEMON_URL || 'http://localhost:3002'
  const whatspowerUrl = process.env.WHATSPOWER_BASE_URL || 'http://localhost:3003'
  const ultraUrl = process.env.ULTRA_BASE_URL || 'http://localhost:3004'

  const probes: Promise<SystemHealth>[] = [
    // 1. Daemon WhatsApp (:3002) — Bearer con INTERNAL_API_SECRET (solo server-side).
    probe('daemon', 'Daemon WhatsApp', 'Canal WhatsApp (sesión, QR, envío)', daemonUrl, async () => {
      const secret = process.env.INTERNAL_API_SECRET
      if (!secret) throw new Error('INTERNAL_API_SECRET no configurado en el CRM')
      const data = (await fetchJson(`${daemonUrl}/status`, {
        headers: { Authorization: `Bearer ${secret}` },
      })) as Record<string, unknown>
      return {
        sesion: data.status ?? 'desconocido',
        telefono: data.phone ?? null,
        orgVinculada: Boolean(data.orgLinked),
        lastError: data.lastError || null,
      }
    }),
    // 2. WHATSPOWER Nivel 2 (:3003) — /api/health público.
    probe('whatspower', 'WHATSPOWER (Nivel 2)', 'Flows, secuencias y puente CRM', whatspowerUrl, async () => {
      const data = (await fetchJson(`${whatspowerUrl}/api/health`)) as Record<string, unknown>
      return { servicio: data.service ?? 'desconocido', estado: data.status ?? 'desconocido' }
    }),
    // 3. ULTRA Nivel 3 (:3004) — /api/health público.
    probe('ultra', 'WHATSPOWER-ULTRA (Nivel 3)', 'Difusión masiva y campañas', ultraUrl, async () => {
      const data = (await fetchJson(`${ultraUrl}/api/health`)) as Record<string, unknown>
      return { servicio: data.service ?? 'desconocido', estado: data.status ?? 'desconocido' }
    }),
  ]

  const [daemon, whatspower, ultra] = await Promise.all(probes)

  const crm: SystemHealth = {
    id: 'crm',
    name: 'CRM ALBRA (Nivel 1)',
    role: 'Núcleo: clientes, pipeline, cotizaciones, finanzas',
    url: 'proceso local (:3000)',
    status: crmDbOk ? 'online' : 'degraded',
    latencyMs: null,
    detail: { baseDatos: crmDbOk ? 'conectada' : 'SIN CONEXIÓN', version: APP_VERSION },
  }

  return [crm, daemon, whatspower, ultra]
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireSuperAdmin(req)

    const [orgs, users, services, crmDbOk] = await Promise.all([
      db.organization.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          isActive: true,
          createdAt: true,
          _count: {
            select: {
              users: true,
              clients: true,
              opportunities: true,
              quotes: true,
              services: true,
              reservations: true,
              whatsappConversations: true,
            },
          },
        },
      }),
      db.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          leadCount: true,
          lastLeadAt: true,
          createdAt: true,
          organization: { select: { name: true, slug: true } },
        },
      }),
      db.service.findMany({
        orderBy: [{ organizationId: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          name: true,
          category: true,
          price: true,
          unit: true,
          isActive: true,
        },
      }),
      db
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
    ])

    // Usuarios clave primero: superadmin → owner → admin → agent → member.
    const roleOrder: Record<string, number> = { superadmin: 0, owner: 1, admin: 2, agent: 3, member: 4 }
    const sortedUsers = [...users].sort(
      (a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime()
    )

    const usersByRole: Record<string, number> = {}
    for (const u of users) usersByRole[u.role] = (usersByRole[u.role] ?? 0) + 1

    // Catálogo de productos/servicios agrupado por organización.
    const catalogs = orgs.map((o) => {
      const items = services.filter((s) => s.organizationId === o.id)
      return {
        orgId: o.id,
        orgName: o.name,
        orgSlug: o.slug,
        total: items.length,
        active: items.filter((s) => s.isActive).length,
        items,
      }
    })

    const systems = await checkSystems(crmDbOk)

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'viewed',
      entity: 'platform',
      details: { section: 'super-overview' },
    })

    return json({
      platform: {
        version: APP_VERSION,
        generatedAt: new Date().toISOString(),
        viewer: { name: auth.email, role: auth.role },
      },
      stats: {
        orgs: orgs.length,
        orgsActive: orgs.filter((o) => o.isActive).length,
        users: users.length,
        usersByRole,
        usersActive: users.filter((u) => u.isActive).length,
        services: services.length,
        servicesActive: services.filter((s) => s.isActive).length,
        clients: orgs.reduce((acc, o) => acc + o._count.clients, 0),
        opportunities: orgs.reduce((acc, o) => acc + o._count.opportunities, 0),
        whatsappConversations: orgs.reduce((acc, o) => acc + o._count.whatsappConversations, 0),
        systemsOnline: systems.filter((s) => s.status === 'online').length,
        systemsTotal: systems.length,
      },
      organizations: orgs,
      users: sortedUsers,
      catalogs,
      systems,
      integrations: {
        // Solo booleanos de configuración: NUNCA valores de secretos.
        whatspowerBridge: {
          enabled: process.env.WHATSPOWER_ENABLED === 'true',
          webhookSecretConfigured: Boolean(process.env.WHATSPOWER_WEBHOOK_SECRET),
          url: process.env.WHATSPOWER_BASE_URL || 'http://localhost:3003',
        },
        daemon: {
          secretConfigured: Boolean(process.env.INTERNAL_API_SECRET),
          url: process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002',
        },
        ultra: {
          url: process.env.ULTRA_BASE_URL || 'http://localhost:3004',
        },
      },
    })
  })
}
