/**
 * GET  /api/whatsapp/connections — conexiones WhatsApp DE LA ORGANIZACIÓN de la sesión.
 * POST /api/whatsapp/connections — registra una conexión (token directo de administrador).
 *
 * Arquitectura (decisión 2026-11-11):
 *  - CRM-ALBRA administra las conexiones y sus permisos (punto 5).
 *  - orgId SIEMPRE de la sesión JWT (jamás del body: cierre de la excepción
 *    "confiar en el organization_id enviado por el cliente").
 *  - Cada organización solo ve SUS conexiones (punto 8).
 *  - El token se recibe UNA VEZ, se cifra y jamás se devuelve en claro.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, json, readBody, str } from '../../_lib/shared'
import { requireAuth, HttpError } from '@/lib/auth'
import { createConnection, activeConnectionCount } from '@/lib/wa-connections'
import { planLimitFor } from '@/lib/whatsapp-plans'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    // (UNIFICACIÓN 2026-11-21) Fuente canónica ChannelConnection; la respuesta
    // conserva la forma del panel (phoneNumberId/phoneNumber/wabaId desde
    // externalAccountId + metadata).
    const rows = await db.channelConnection.findMany({
      where: { organizationId: auth.orgId, channel: 'whatsapp', provider: 'meta_cloud' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, externalAccountId: true, displayName: true,
        status: true, tokenExpiresAt: true,
        lastVerifiedAt: true, lastErrorAt: true, createdAt: true, updatedAt: true,
        metadata: true,
      },
    })
    const connections = rows.map((c) => {
      let meta: Record<string, unknown> = {}
      try { meta = c.metadata ? JSON.parse(c.metadata) as Record<string, unknown> : {} } catch {}
      return {
        id: c.id,
        wabaId: typeof meta.wabaId === 'string' ? meta.wabaId : null,
        phoneNumberId: c.externalAccountId,
        phoneNumber: typeof meta.phoneNumber === 'string' ? meta.phoneNumber : c.externalAccountId,
        displayName: c.displayName,
        status: c.status,
        statusDetail: typeof meta.statusDetail === 'string' ? meta.statusDetail : null,
        source: typeof meta.source === 'string' ? meta.source : 'embedded_signup',
        tokenExpiresAt: c.tokenExpiresAt,
        lastVerifiedAt: c.lastVerifiedAt,
        lastErrorAt: c.lastErrorAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }
    })
    const active = await activeConnectionCount(auth.orgId)
    const plan = await db.organization.findUnique({
      where: { id: auth.orgId }, select: { plan: true },
    })
    const limit = planLimitFor(plan?.plan)
    return json({
      connections,
      plan: { id: plan?.plan ?? 'pilot', label: limit.label, maxConnections: limit.maxConnections, activeConnections: active },
    })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    if (!auth.isAdmin) throw new HttpError(403, 'Solo un administrador puede conectar números de WhatsApp')
    const body = await readBody(req)
    const phoneNumberId = str(body.phoneNumberId)
    const accessToken = str(body.accessToken)
    if (!phoneNumberId || !accessToken) {
      throw new HttpError(400, 'Campos requeridos: phoneNumberId, accessToken')
    }
    if (body.organizationId && body.organizationId !== auth.orgId) {
      // Decisión #8: impedir crear conexiones "para otra organización".
      throw new HttpError(403, 'No puedes conectar números para otra organización')
    }
    const result = await createConnection({
      orgId: auth.orgId,
      phoneNumberId,
      accessToken,
      wabaId: str(body.wabaId),
      phoneNumber: str(body.phoneNumber),
      displayName: str(body.displayName),
      source: 'manual',
      metaAppSecret: str(body.metaAppSecret),
    })
    if (!result.ok) {
      const status = result.code === 'plan_limit' ? 402 : result.code === 'duplicate' ? 409 : 400
      throw new HttpError(status, result.message)
    }
    return json({ ok: true, connectionId: result.connectionId, status: result.status }, { status: 201 })
  })
}
