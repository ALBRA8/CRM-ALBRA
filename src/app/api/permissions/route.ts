import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '../_lib/shared'
import { ROLE_PERMISSIONS, KNOWN_ROLES } from '@/lib/rbac'

/**
 * GET /api/permissions — mapa de capacidades por rol.
 * Claves 'agent' y 'member' comparten el mismo nivel de acceso (el frontend
 * usa 'agent' como rol por defecto para los miembros del equipo).
 *
 * Fase 2: el mapa vive en src/lib/rbac.ts (fuente única) que también aplica
 * requirePermission en el servidor. Lo que este endpoint anuncia es EXACTAMENTE
 * lo que el backend hace cumplir.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireAuth(req)
    return json({ permissions: ROLE_PERMISSIONS, roles: [...KNOWN_ROLES] })
  })
}
