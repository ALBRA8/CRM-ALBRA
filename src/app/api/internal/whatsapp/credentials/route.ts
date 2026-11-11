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
 *   GET /api/internal/whatsapp/credentials
 *     → inventario de conexiones de la org autenticada (ids/números, SIN tokens).
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
import { dbRateLimit } from '@/lib/rate-limit'

/**
 * (A1-12, auditoría 2026-11-11) Rate limit DURABLE por orgId (dbRateLimit,
 * tabla RateLimitBucket): el límite del contrato §5 es efectivo entre
 * instancias — el Map por proceso lo multiplicaba por N réplicas.
 */
async function rateLimited(orgId: string): Promise<boolean> {
  const rl = await dbRateLimit(`wa-cred:${orgId}`, 60, 60_000)
  return !rl.ok
}

export async function GET(req: NextRequest) {
  try {
    // Solo credenciales de servicio con ROL ADMIN resuelven tokens de WhatsApp:
    // la resolución de credenciales es una operación sensible (el daemon de
    // envío opera con credencial admin; un 'agent' jamás obtiene tokens).
    const identity = requireInternalAdmin(req.headers.get('authorization') ?? undefined)
    if (await rateLimited(identity.orgId)) {
      return json({ error: 'Demasiadas peticiones' }, { status: 429, headers: { 'Retry-After': '60' } })
    }
    const url = new URL(req.url)
    const phoneNumberId = url.searchParams.get('phoneNumberId')
    const connectionId = url.searchParams.get('connectionId')

    // SIN parámetros → INVENTARIO de conexiones de la organización autenticada
    // (SOLO identidad: ids y números; JAMÁS tokens). WHATSPOWER/ULTRA lo usan
    // para saber con qué número despacha cada org (decisión #6/#7).
    if (!phoneNumberId && !connectionId) {
      const connections = await db.whatsAppConnection.findMany({
        where: { organizationId: identity.orgId, status: 'connected' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, phoneNumberId: true, phoneNumber: true, wabaId: true, displayName: true },
      })
      return json({ organizationId: identity.orgId, connections })
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
