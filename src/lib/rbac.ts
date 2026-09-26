/**
 * RBAC granular del CRM ALBRA (Fase 2 del plan maestro).
 *
 * Fuente ÚNICA de verdad para capacidades por rol. La consumen:
 *  - El servidor (`requirePermission` en src/lib/auth.ts) como autoridad final.
 *  - El cliente (sidebar, guardas de vistas en AppShell) solo como UX:
 *    oculta lo que el usuario no puede usar; el servidor siempre re-valida.
 *
 * Compatibilidad con /api/permissions: este endpoint ahora importa desde aquí,
 * de modo que el contrato público y la aplicación real nunca divergen.
 *
 * Nomenclatura: `<recurso>.<acción>` con `.*` como comodín de recurso
 * (ej: 'settings.*' cubre 'settings.read' y 'settings.write').
 *
 * Roles:
 *  - owner / admin → todo el negocio (equipo, automatizaciones, plantillas,
 *    configuración, integraciones, reportes, exportación, campos custom).
 *  - agent / member → trabajo operativo diario: clientes, oportunidades,
 *    pipeline, cotizaciones, reservas, transacciones, servicios, actividad,
 *    IA, notificaciones y la bandeja de canal (WhatsApp), que es el núcleo
 *    del rol comercial.
 */

export const AGENT_PERMISSIONS = [
  'clients.read',
  'clients.write',
  'clients.history',
  'opportunities.read',
  'opportunities.write',
  'pipeline.read',
  'quotes.read',
  'quotes.write',
  'reservations.read',
  'reservations.write',
  'transactions.read',
  'transactions.write',
  'services.read',
  'activity.read',
  'ai.use',
  'notifications.read',
  'whatsapp.read',
  'whatsapp.write',
] as const

export const ADMIN_EXTRA_PERMISSIONS = [
  'team.manage',
  'automations.*',
  'templates.*',
  'settings.*',
  'integrations.*',
  'reports.read',
  'export.data',
  'custom-fields.*',
  'permissions.read',
] as const

/** Mapa de capacidades por rol (contrato de GET /api/permissions). */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: [...AGENT_PERMISSIONS, ...ADMIN_EXTRA_PERMISSIONS],
  admin: [...AGENT_PERMISSIONS, ...ADMIN_EXTRA_PERMISSIONS],
  agent: [...AGENT_PERMISSIONS],
  member: [...AGENT_PERMISSIONS],
}

export const KNOWN_ROLES = ['owner', 'admin', 'agent', 'member'] as const

/** Normaliza roles legados/desconocidos al nivel menos privilegiado. */
export function normalizeRole(role: string | null | undefined): string {
  const r = (role || '').toLowerCase().trim()
  return (KNOWN_ROLES as readonly string[]).includes(r) ? r : 'member'
}

/**
 * ¿Puede `role` ejercer `capability`?
 * Soporta comodines de recurso: 'settings.*' concede 'settings.write'.
 * Roles desconocidos caen en 'member' (fail-closed con el nivel operativo).
 */
export function can(role: string | null | undefined, capability: string): boolean {
  const perms = ROLE_PERMISSIONS[normalizeRole(role)] ?? []
  return perms.some(
    (p) => p === capability || (p.endsWith('.*') && capability.startsWith(p.slice(0, -1)))
  )
}

/** ¿Es rol administrador (owner/admin)? Equivalente a isAdmin del JWT. */
export function isAdminRole(role: string | null | undefined): boolean {
  const r = normalizeRole(role)
  return r === 'owner' || r === 'admin'
}
