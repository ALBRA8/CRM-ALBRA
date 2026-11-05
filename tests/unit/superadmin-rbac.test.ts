import { describe, expect, it } from 'vitest'
import {
  can,
  normalizeRole,
  isAdminRole,
  ROLE_PERMISSIONS,
  KNOWN_ROLES,
  PLATFORM_PERMISSIONS,
} from '@/lib/rbac'

/**
 * Rol de plataforma `superadmin` (plano de control multi-organización):
 *  - Es un SUPERCONJUNTO de owner: conserva todas las capacidades de
 *    organización (settings, equipo, clientes...) para no romper el día a día.
 *  - Añade las capacidades exclusivas 'platform.*' que ningún otro rol tiene.
 *  - NADIE puede adquirirlo por API: solo existe por promoción directa en BD
 *    (scripts/promote-superadmin.mjs); /api/team y /api/auth/register no lo
 *    ofrecen como opción de rol.
 */
describe('RBAC: rol de plataforma superadmin', () => {
  it('es un rol conocido y se normaliza sin cambios', () => {
    expect(KNOWN_ROLES).toContain('superadmin')
    expect(normalizeRole('superadmin')).toBe('superadmin')
    expect(normalizeRole('SUPERADMIN')).toBe('superadmin')
    expect(normalizeRole('super-admin')).toBe('member') // fail-closed
  })

  it('tiene las capacidades exclusivas del plano de control', () => {
    expect(PLATFORM_PERMISSIONS).toContain('platform.read')
    expect(PLATFORM_PERMISSIONS).toContain('platform.manage')
    expect(can('superadmin', 'platform.read')).toBe(true)
    expect(can('superadmin', 'platform.manage')).toBe(true)
  })

  it('es superconjunto de owner: conserva todo el negocio de su organización', () => {
    for (const perm of ROLE_PERMISSIONS.owner) {
      expect(can('superadmin', perm)).toBe(true)
    }
  })

  it('ningún rol de organización puede ver el plano de control (fail-closed)', () => {
    for (const role of ['owner', 'admin', 'agent', 'member']) {
      expect(can(role, 'platform.read')).toBe(false)
      expect(can(role, 'platform.manage')).toBe(false)
    }
    expect(can('inventado', 'platform.read')).toBe(false)
    expect(can(null, 'platform.read')).toBe(false)
  })

  it('isAdminRole reconoce superadmin como administrador dentro de su organización', () => {
    expect(isAdminRole('superadmin')).toBe(true)
    expect(isAdminRole('owner')).toBe(true)
    expect(isAdminRole('admin')).toBe(true)
    expect(isAdminRole('agent')).toBe(false)
    expect(isAdminRole('member')).toBe(false)
  })
})
