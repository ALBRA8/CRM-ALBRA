import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '../_lib/shared'

/**
 * GET /api/permissions — mapa de capacidades por rol.
 * Claves 'agent' y 'member' comparten el mismo nivel de acceso (el frontend
 * usa 'agent' como rol por defecto para los miembros del equipo).
 */
const AGENT_PERMISSIONS = [
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
]

export async function GET(req: NextRequest) {
  return handle(async () => {
    requireAuth(req)
    const permissions: Record<string, string[]> = {
      owner: [...AGENT_PERMISSIONS, 'team.manage', 'automations.*', 'templates.*', 'settings.*', 'integrations.*', 'reports.read', 'export.data', 'custom-fields.*', 'permissions.read'],
      admin: [...AGENT_PERMISSIONS, 'team.manage', 'automations.*', 'templates.*', 'settings.*', 'integrations.*', 'reports.read', 'export.data', 'custom-fields.*', 'permissions.read'],
      agent: AGENT_PERMISSIONS,
      member: AGENT_PERMISSIONS,
    }
    return json({ permissions, roles: ['owner', 'admin', 'agent', 'member'] })
  })
}
