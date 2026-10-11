/**
 * CRM ALBRA — Claves de API para el Servidor MCP (Task 27).
 *
 * Principios de seguridad:
 * - La clave cruda (`albra_<48 hex>`) se genera UNA vez y se devuelve en la
 *   respuesta de creación; en base de datos SOLO vive su hash SHA-256.
 * - La búsqueda por hash es O(1) (hashedKey @unique) y no filtra por timing
 *   (comparación exacta por índice, no por bytes de la clave).
 * - Revocación inmediata vía revokedAt + verificación de organización activa.
 */

import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'

export const API_KEY_PREFIX = 'albra'

/** Genera una clave cruda nueva y su huella almacenable. */
export function generateApiKey(): { raw: string; hashedKey: string; prefix: string } {
  const raw = `${API_KEY_PREFIX}_${randomBytes(24).toString('hex')}`
  return { raw, hashedKey: hashApiKey(raw), prefix: raw.slice(0, 11) }
}

/** SHA-256 hex de la clave cruda (misma función para crear y para lookup). */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface ApiKeyLookup {
  id: string
  organizationId: string
  orgName: string
  orgActive: boolean
}

/** Busca la clave por hash y la descarta si está revocada o la org inactiva. */
export async function lookupApiKey(raw: string): Promise<ApiKeyLookup | null> {
  if (!raw || raw.length < 16) return null
  const row = await db.apiKey.findUnique({
    where: { hashedKey: hashApiKey(raw) },
    select: {
      id: true,
      revokedAt: true,
      organizationId: true,
      organization: { select: { name: true, isActive: true } },
    },
  })
  if (!row || row.revokedAt) return null
  return {
    id: row.id,
    organizationId: row.organizationId,
    orgName: row.organization.name,
    orgActive: row.organization.isActive,
  }
}
