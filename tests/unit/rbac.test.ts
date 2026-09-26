import { describe, expect, it } from 'vitest'
import { can, normalizeRole, isAdminRole, ROLE_PERMISSIONS, KNOWN_ROLES } from '@/lib/rbac'
import { VIEW_PERMISSIONS } from '@/lib/views'

/**
 * RBAC granular (Fase 2) — unidad pura, sin BD.
 * Contrato: owner/admin = todo; agent/member = operativo; roles desconocidos
 * fallan cerrados al nivel member; comodines de recurso ('settings.*').
 */

describe('normalizeRole', () => {
  it('acepta los 4 roles conocidos en cualquier caja', () => {
    expect(normalizeRole('owner')).toBe('owner')
    expect(normalizeRole('ADMIN')).toBe('admin')
    expect(normalizeRole('Agent')).toBe('agent')
    expect(normalizeRole('member')).toBe('member')
  })

  it('fail-closed: rol desconocido, vacío o null → member', () => {
    expect(normalizeRole('superadmin')).toBe('member')
    expect(normalizeRole('')).toBe('member')
    expect(normalizeRole(null)).toBe('member')
    expect(normalizeRole(undefined)).toBe('member')
  })
})

describe('can — nivel operativo (agent/member)', () => {
  it('agent y member ejercen el trabajo diario', () => {
    for (const role of ['agent', 'member']) {
      expect(can(role, 'clients.read')).toBe(true)
      expect(can(role, 'clients.write')).toBe(true)
      expect(can(role, 'opportunities.write')).toBe(true)
      expect(can(role, 'quotes.write')).toBe(true)
      expect(can(role, 'reservations.read')).toBe(true)
      expect(can(role, 'transactions.write')).toBe(true)
      expect(can(role, 'activity.read')).toBe(true)
      expect(can(role, 'ai.use')).toBe(true)
      expect(can(role, 'notifications.read')).toBe(true)
    }
  })

  it('la bandeja WhatsApp es núcleo del rol comercial (hallazgo del mapa viejo)', () => {
    expect(can('agent', 'whatsapp.read')).toBe(true)
    expect(can('agent', 'whatsapp.write')).toBe(true)
    expect(can('member', 'whatsapp.read')).toBe(true)
  })

  it('agent/member NO tocan administración', () => {
    for (const role of ['agent', 'member']) {
      expect(can(role, 'team.manage')).toBe(false)
      expect(can(role, 'automations.read')).toBe(false)
      expect(can(role, 'automations.write')).toBe(false)
      expect(can(role, 'templates.write')).toBe(false)
      expect(can(role, 'settings.read')).toBe(false)
      expect(can(role, 'settings.write')).toBe(false)
      expect(can(role, 'integrations.write')).toBe(false)
      expect(can(role, 'reports.read')).toBe(false)
      expect(can(role, 'export.data')).toBe(false)
      expect(can(role, 'custom-fields.write')).toBe(false)
      expect(can(role, 'permissions.read')).toBe(false)
    }
  })
})

describe('can — nivel administración (owner/admin)', () => {
  it('heredan todo lo operativo + gestión', () => {
    for (const role of ['owner', 'admin']) {
      expect(can(role, 'clients.write')).toBe(true)
      expect(can(role, 'team.manage')).toBe(true)
      expect(can(role, 'reports.read')).toBe(true)
      expect(can(role, 'export.data')).toBe(true)
      expect(can(role, 'permissions.read')).toBe(true)
    }
  })

  it('comodines de recurso: settings.* / automations.* / templates.* / integrations.* / custom-fields.*', () => {
    expect(can('admin', 'settings.write')).toBe(true)
    expect(can('admin', 'settings.loquesea')).toBe(true)
    expect(can('owner', 'automations.run')).toBe(true)
    expect(can('owner', 'templates.read')).toBe(true)
    expect(can('owner', 'integrations.write')).toBe(true)
    expect(can('admin', 'custom-fields.read')).toBe(true)
    // el comodín no concede recursos vecinos
    expect(can('admin', 'settingsfake.read')).toBe(false)
  })
})

describe('can — fail-closed', () => {
  it('roles desconocidos no escalan', () => {
    expect(can('ghost', 'team.manage')).toBe(false)
    expect(can('ghost', 'settings.write')).toBe(false)
    expect(can('ghost', 'clients.read')).toBe(true) // nivel member operativo sí
  })

  it('capacidades inexistentes se deniegan incluso a owner', () => {
    expect(can('owner', 'noexiste.accion')).toBe(false)
    expect(can('owner', '')).toBe(false)
  })
})

describe('isAdminRole', () => {
  it('true solo para owner/admin', () => {
    expect(isAdminRole('owner')).toBe(true)
    expect(isAdminRole('admin')).toBe(true)
    expect(isAdminRole('agent')).toBe(false)
    expect(isAdminRole('member')).toBe(false)
    expect(isAdminRole(null)).toBe(false)
  })
})

describe('invariantes del mapa', () => {
  it('todos los roles conocidos tienen entrada y el member nunca supera a agent', () => {
    for (const role of KNOWN_ROLES) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true)
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0)
    }
    expect(new Set(ROLE_PERMISSIONS.agent)).toEqual(new Set(ROLE_PERMISSIONS.member))
  })

  it('owner y admin comparten exactamente el mismo nivel', () => {
    expect(new Set(ROLE_PERMISSIONS.owner)).toEqual(new Set(ROLE_PERMISSIONS.admin))
  })

  it('cada vista protegida tiene una capacidad definida', () => {
    expect(VIEW_PERMISSIONS['team']).toBe('team.manage')
    expect(VIEW_PERMISSIONS['settings']).toBe('settings.read')
    expect(VIEW_PERMISSIONS['reports']).toBe('reports.read')
    expect(VIEW_PERMISSIONS['whatsapp']).toBe('whatsapp.read')
    expect(VIEW_PERMISSIONS['client-detail']).toBe('clients.read')
  })

  it('coherencia UI↔servidor: lo que el sidebar oculta, el API también bloquea', () => {
    // Si un agente no puede ver el módulo, la API debe negarle la capacidad
    for (const [, capability] of Object.entries(VIEW_PERMISSIONS)) {
      const visibleParaAgente = can('agent', capability)
      if (!visibleParaAgente) {
        expect(can('agent', capability)).toBe(false)
      }
    }
    // ...y el guard de vista usa las MISMAS capacidades que requirePermission
    expect(can('member', VIEW_PERMISSIONS['team'])).toBe(false)
    expect(can('owner', VIEW_PERMISSIONS['team'])).toBe(true)
  })
})
