/**
 * GET /api/whatsapp/connections-panel — vista agregada del panel de Conexiones
 * WhatsApp multi-número de la organización (F2, plan definitivo §5.1 F3-T02).
 *
 * UNA sola llamada entrega a la UI:
 *  - el consumo del plan (autoridad en whatsapp-plans.ts, servidor);
 *  - las conexiones Cloud API de la organización (sin material sensible);
 *  - el veredicto REAL de la sesión Baileys (sessions[] del daemon, traducido
 *    por el módulo puro mapStatusToVerdict ya probado).
 *
 * Seguridad:
 *  - requireAuth: orgId SIEMPRE del JWT (jamás del cliente) — aislamiento
 *    multi-tenant idéntico al resto de rutas de conexiones.
 *  - El daemon se consulta server-to-server con INTERNAL_API_SECRET; si el
 *    daemon no responde NO se simula estado: veredicto UNKNOWN → fail-closed
 *    (mismo principio del proxy daemon-proxy).
 *  - Las acciones (conectar/verificar/desconectar) siguen viniendo del propio
 *    cliente contra sus rutas existentes; aquí solo se LEE el estado.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, json } from '../../_lib/shared'
import { requireAuth } from '@/lib/auth'
import { activeConnectionCount } from '@/lib/wa-connections'
import { planLimitFor } from '@/lib/whatsapp-plans'
import { mapStatusToVerdict, type DaemonStatusPayload } from '@/lib/whatsapp-session-verdict'
import {
  buildConnectionsPanelView,
  type BaileysSessionInfo,
  type CloudConnectionRow,
} from '@/lib/wa-connections-view'

const DAEMON_URL = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'
const TIMEOUT_MS = 1500

/**
 * Consulta el estado del daemon y devuelve el veredicto de propiedad de la
 * organización + su entrada de sesión (o null). Fail-closed: cualquier fallo
 * (daemon caído, timeout, respuesta ambigua) → verdict 'UNKNOWN', session null.
 */
async function resolveBaileysStatus(
  orgId: string,
): Promise<{ verdict: ReturnType<typeof mapStatusToVerdict>; session: BaileysSessionInfo | null }> {
  if (!process.env.INTERNAL_API_SECRET) {
    return { verdict: 'UNKNOWN', session: null }
  }
  let payload: DaemonStatusPayload
  try {
    const res = await fetch(`${DAEMON_URL}/status`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return { verdict: 'UNKNOWN', session: null }
    payload = (await res.json()) as DaemonStatusPayload
  } catch {
    return { verdict: 'UNKNOWN', session: null } // daemon caído / timeout → sin estado fingido
  }
  // Contrato completo del daemon (ver cabecera de whatsapp-session-verdict.ts):
  // además de orgLinked/linkedOrgId/sessions incluye status/phone/lastError;
  // el tipo compartido solo declara los 3 campos que el veredicto necesita.
  const full = payload as DaemonStatusPayload & { status?: unknown; phone?: unknown; lastError?: unknown }
  const verdict = mapStatusToVerdict(payload, orgId)
  let session: BaileysSessionInfo | null = null
  if (verdict === 'SAME_ORG' && Array.isArray(payload.sessions)) {
    const mine = (payload.sessions as Array<Record<string, unknown>>).find(
      (s) => s && typeof s === 'object' && s.orgId === orgId,
    )
    if (mine) {
      session = {
        status: typeof mine.status === 'string' ? mine.status : null,
        phone: typeof mine.phone === 'string' ? mine.phone : null,
        lastUpdate: typeof mine.lastUpdate === 'string' ? mine.lastUpdate : null,
        lastError: typeof mine.lastError === 'string' ? mine.lastError : null,
      }
    }
  }
  // Daemon legacy de UNA sesión (sin sessions[]): si el veredicto es SAME_ORG la
  // sesión vinculada es la de esta org — exponer su estado básico si el payload lo trae.
  if (!session && verdict === 'SAME_ORG' && typeof full.status === 'string') {
    session = {
      status: full.status,
      phone: typeof full.phone === 'string' ? full.phone : null,
      lastUpdate: null,
      lastError: typeof full.lastError === 'string' ? full.lastError : null,
    }
  }
  return { verdict, session }
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)

    // (UNIFICACIÓN 2026-11-21) Fuente canónica ChannelConnection (meta_cloud):
    // phoneNumberId/phoneNumber/statusDetail/source se resuelven de metadata.
    const [rows, active, org] = await Promise.all([
      db.channelConnection.findMany({
        where: { organizationId: auth.orgId, channel: 'whatsapp', provider: 'meta_cloud' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, externalAccountId: true, displayName: true,
          status: true, lastVerifiedAt: true, lastErrorAt: true, createdAt: true,
          metadata: true,
        },
      }),
      activeConnectionCount(auth.orgId),
      db.organization.findUnique({ where: { id: auth.orgId }, select: { plan: true } }),
    ])
    const connections = rows.map((c) => {
      let meta: Record<string, unknown> = {}
      try { meta = c.metadata ? JSON.parse(c.metadata) as Record<string, unknown> : {} } catch {}
      return {
        id: c.id,
        phoneNumberId: c.externalAccountId,
        phoneNumber: typeof meta.phoneNumber === 'string' ? meta.phoneNumber : c.externalAccountId,
        displayName: c.displayName,
        status: c.status,
        statusDetail: typeof meta.statusDetail === 'string' ? meta.statusDetail : null,
        source: typeof meta.source === 'string' ? meta.source : 'embedded_signup',
        lastVerifiedAt: c.lastVerifiedAt,
        lastErrorAt: c.lastErrorAt,
        createdAt: c.createdAt,
      }
    })

    const limit = planLimitFor(org?.plan)
    const { verdict, session } = await resolveBaileysStatus(auth.orgId)

    const view = buildConnectionsPanelView({
      cloudConnections: connections.map((c) => ({
        ...c,
        lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
        lastErrorAt: c.lastErrorAt?.toISOString() ?? null,
        createdAt: c.createdAt?.toISOString() ?? null,
      })) satisfies CloudConnectionRow[],
      plan: {
        plan: org?.plan ?? 'pilot',
        label: limit.label,
        maxConnections: limit.maxConnections,
        activeConnections: active,
      },
      baileysVerdict: verdict,
      baileysSession: session,
      isAdmin: auth.isAdmin,
    })

    return json(view)
  })
}
