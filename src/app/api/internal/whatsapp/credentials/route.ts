/**
 * GET /api/internal/whatsapp/credentials — resolución de credenciales WhatsApp
 * POR ORGANIZACIÓN para WHATSPOWER y ULTRA (contrato de identidad OLEADA 2).
 *
 * Auth: credencial de servicio POR ORGANIZACIÓN (INTERNAL_API_KEYS, formato
 * "orgId:secreto[:rol]" — mismo contrato §1 de WHATSPOWER). El orgId SIEMPRE
 * se resuelve DE LA CREDENCIAL (jamás de un parámetro del cliente): cierre
 * definitivo de la excepción de seguridad "confiar en el org del cliente".
 *
 * Uso correcto (WHATSPOWER/ULTRA ejecutan envíos con las credenciales de cada
 * organización — decisión #6/#7):
 *   GET /api/internal/whatsapp/credentials?phoneNumberId=<id>
 *     → credenciales del número SIEMPRE que pertenezca a la organización
 *       autenticada; números de otras orgs responden 404 (sin revelar nada).
 *
 * Segregación por número: una organización con varios números puede consultar
 * cualquiera de LOS SUYOS, nunca los de otra (404).
 */
import type { NextRequest } from 'next/server'
import { json } from '../../../_lib/shared'
import { requireInternalAdmin } from '@/lib/internal-org-auth'
import { resolveInternalCredentials } from '@/lib/wa-connections'
import { db } from '@/lib/db'

/** Rate limit simple en memoria por orgId (evita fuerza bruta de phoneNumberId). */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 60

function rateLimited(orgId: string): boolean {
  const now = Date.now()
  const entry = attempts.get(orgId)
  if (!entry || entry.resetAt < now) {
    attempts.set(orgId, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > MAX_ATTEMPTS
}

export async function GET(req: NextRequest) {
  try {
    // Solo credenciales de servicio con ROL ADMIN resuelven tokens de WhatsApp:
    // la resolución de credenciales es una operación sensible (el daemon de
    // envío opera con credencial admin; un 'agent' jamás obtiene tokens).
    const identity = requireInternalAdmin(req.headers.get('authorization') ?? undefined)
    if (rateLimited(identity.orgId)) {
      return json({ error: 'Demasiadas peticiones' }, { status: 429, headers: { 'Retry-After': '60' } })
    }
    const url = new URL(req.url)
    const phoneNumberId = url.searchParams.get('phoneNumberId')
    const connectionId = url.searchParams.get('connectionId')
    if (!phoneNumberId && !connectionId) {
      return json({ error: 'Parámetro requerido: phoneNumberId (o connectionId)' }, { status: 400 })
    }

    // Resolución SIEMPRE por identidad de credencial → org autenticada.
    // Para connectionId, la conexión debe pertenecer a la org autenticada:
    // se consulta por (connectionId, organizationId) — una credencial de
    // servicio jamás puede leer conexiones ajenas (404, sin detalles).
    if (connectionId) {
      const connection = await db.whatsAppConnection.findFirst({
        where: { id: connectionId, organizationId: identity.orgId, status: 'connected' },
        select: { phoneNumberId: true },
      })
      if (!connection) return json({ error: 'No encontrada' }, { status: 404 })
      const resolved = await resolveInternalCredentials(identity.orgId, connection.phoneNumberId)
      if (!resolved.ok) return json({ error: resolved.code === 'not_connected' ? 'Conexión no activa' : 'No encontrada' }, { status: resolved.code === 'not_connected' ? 409 : 404 })
      return json({
        organizationId: identity.orgId,
        connectionId: resolved.connectionId,
        phoneNumberId: connection.phoneNumberId,
        wabaId: resolved.wabaId,
        phoneNumber: resolved.phoneNumber,
        // Token en claro SOLO por este canal autenticado, nunca logueado.
        accessToken: resolved.accessToken,
      })
    }

    const resolved = await resolveInternalCredentials(identity.orgId, phoneNumberId as string)
    if (!resolved.ok) {
      return json(
        { error: resolved.code === 'not_connected' ? 'Conexión no activa' : 'No encontrada' },
        { status: resolved.code === 'not_connected' ? 409 : 404 },
      )
    }
    return json({
      organizationId: identity.orgId,
      connectionId: resolved.connectionId,
      phoneNumberId,
      wabaId: resolved.wabaId,
      phoneNumber: resolved.phoneNumber,
      accessToken: resolved.accessToken,
    })
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500
    const message = (err as { message?: string })?.message ?? 'Error interno'
    if (status === 500) console.error('[internal/whatsapp/credentials]', err)
    return json({ error: message }, { status })
  }
}
