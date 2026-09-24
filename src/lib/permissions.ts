import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-auth'
import { db } from '@/lib/db'

// Role hierarchy: owner > admin > agent
const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  admin: 2,
  agent: 1,
}

// Permission definitions by resource and action
type Action = 'create' | 'read' | 'update' | 'delete' | 'manage'
type Resource = 'clients' | 'opportunities' | 'quotes' | 'transactions' | 'services' | 'automations' | 'reports' | 'settings' | 'users' | 'templates' | 'custom_fields' | 'notifications' | 'calendar'

const PERMISSIONS: Record<string, Record<Action, string[]>> = {
  clients: {
    create: ['owner', 'admin', 'agent'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin', 'agent'],
    delete: ['owner', 'admin'],
  },
  opportunities: {
    create: ['owner', 'admin', 'agent'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin', 'agent'],
    delete: ['owner', 'admin'],
  },
  quotes: {
    create: ['owner', 'admin', 'agent'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin', 'agent'],
    delete: ['owner', 'admin'],
  },
  transactions: {
    create: ['owner', 'admin', 'agent'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin'],
    delete: ['owner', 'admin'],
  },
  services: {
    create: ['owner', 'admin'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin'],
    delete: ['owner', 'admin'],
  },
  automations: {
    create: ['owner', 'admin'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin'],
    delete: ['owner', 'admin'],
  },
  reports: {
    read: ['owner', 'admin', 'agent'],
    manage: ['owner', 'admin'],
  },
  settings: {
    read: ['owner', 'admin'],
    update: ['owner', 'admin'],
  },
  users: {
    create: ['owner'],
    read: ['owner', 'admin'],
    update: ['owner'],
    delete: ['owner'],
  },
  templates: {
    create: ['owner', 'admin'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin'],
    delete: ['owner', 'admin'],
  },
  custom_fields: {
    create: ['owner', 'admin'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin'],
    delete: ['owner', 'admin'],
  },
  notifications: {
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin', 'agent'],
  },
  calendar: {
    create: ['owner', 'admin', 'agent'],
    read: ['owner', 'admin', 'agent'],
    update: ['owner', 'admin', 'agent'],
    delete: ['owner', 'admin', 'agent'],
  },
}

/**
 * Check if a role has permission for a specific resource and action
 */
export function hasPermission(role: string, resource: Resource, action: Action): boolean {
  const resourcePerms = PERMISSIONS[resource]
  if (!resourcePerms) return false
  const allowedRoles = resourcePerms[action]
  if (!allowedRoles) return false
  return allowedRoles.includes(role)
}

/**
 * Check if role A is at least at the level of role B
 */
export function isAtLeastRole(role: string, minRole: string): boolean {
  return (ROLE_LEVELS[role] || 0) >= (ROLE_LEVELS[minRole] || 0)
}

/**
 * Middleware helper: Authenticate + check permission
 * Returns the authenticated user or a 403 response
 */
export async function checkPermission(
  request: NextRequest,
  resource: Resource,
  action: Action
): Promise<{ userId: string; email: string; role: string } | NextResponse> {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth

  // Fetch user role
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, role: true, isActive: true },
  })

  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Usuario no encontrado o inactivo' }, { status: 403 })
  }

  if (!hasPermission(user.role, resource, action)) {
    return NextResponse.json(
      { error: 'No tienes permisos para realizar esta accion', required: `${resource}.${action}`, yourRole: user.role },
      { status: 403 }
    )
  }

  return { userId: user.id, email: user.email, role: user.role }
}

/**
 * Admin-only check shortcut
 */
export async function requireAdmin(
  request: NextRequest
): Promise<{ userId: string; email: string; role: string } | NextResponse> {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth

  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, role: true, isActive: true },
  })

  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Usuario no encontrado o inactivo' }, { status: 403 })
  }

  if (!isAtLeastRole(user.role, 'admin')) {
    return NextResponse.json({ error: 'Se requiere rol de administrador o superior' }, { status: 403 })
  }

  return { userId: user.id, email: user.email, role: user.role }
}

/**
 * Owner-only check shortcut
 */
export async function requireOwner(
  request: NextRequest
): Promise<{ userId: string; email: string; role: string } | NextResponse> {
  const auth = await getAuthUser(request)
  if (auth instanceof NextResponse) return auth

  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, email: true, role: true, isActive: true },
  })

  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Usuario no encontrado o inactivo' }, { status: 403 })
  }

  if (user.role !== 'owner') {
    return NextResponse.json({ error: 'Se requiere rol de propietario' }, { status: 403 })
  }

  return { userId: user.id, email: user.email, role: user.role }
}

/**
 * Get all permissions for a given role (useful for frontend)
 */
export function getRolePermissions(role: string): Record<string, Action[]> {
  const result: Record<string, Action[]> = {}
  for (const [resource, actions] of Object.entries(PERMISSIONS)) {
    const allowed: Action[] = []
    for (const [action, roles] of Object.entries(actions)) {
      if (roles.includes(role)) {
        allowed.push(action as Action)
      }
    }
    if (allowed.length > 0) {
      result[resource] = allowed
    }
  }
  return result
}
