import type { NextRequest } from 'next/server'
import { lookupApiKey } from '@/lib/api-keys'
import { handleMcpPost, SUPPORTED_PROTOCOL_VERSIONS } from '@/lib/mcp/protocol'
import { CRM_TOOLS } from '@/lib/mcp/tools'
import { db } from '@/lib/db'

/**
 * POST /api/mcp — Servidor MCP de CRM ALBRA (Task 27, Opción B).
 *
 * Transporte "Streamable HTTP" del spec MCP en modo STATELESS:
 * - Autenticación: `Authorization: Bearer albra_…` (API key de la org).
 * - El cliente POSTea un mensaje JSON-RPC y recibe application/json.
 * - Notificaciones (sin id) → 202 sin cuerpo.
 * - GET/DELETE → 405 (no ofrecemos stream SSE ni sesiones).
 * - Cabecera `MCP-Protocol-Version` opcional; si llega con una versión que
 *   no hablamos → 400 (spec 2025-06-18).
 *
 * Clientes compatibles: Claude Desktop/Code (conector remoto), Cursor,
 * Windsurf, o cualquier cliente MCP con transporte HTTP + headers custom.
 */

function bearerOf(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: 'Método no permitido: este endpoint MCP solo acepta POST (JSON-RPC 2.0)' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST' },
  })
}

export async function POST(req: NextRequest) {
  // 1) Autenticación SIEMPRE primero (incluso para cuerpos inválidos).
  const raw = bearerOf(req)
  if (!raw) {
    return Response.json({ error: 'Falta la cabecera Authorization: Bearer <api-key>' }, { status: 401 })
  }
  const key = await lookupApiKey(raw)
  if (!key || !key.orgActive) {
    return Response.json({ error: 'API key inválida o revocada' }, { status: 401 })
  }

  // 2) Versión del protocolo declarada por el cliente (opcional).
  const declared = req.headers.get('mcp-protocol-version')
  if (declared && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(declared)) {
    return Response.json(
      { error: `MCP-Protocol-Version no soportada: ${declared}`, supported: SUPPORTED_PROTOCOL_VERSIONS },
      { status: 400 }
    )
  }

  // 3) Último uso (telemetría de la UI; nunca bloquea la respuesta).
  try {
    await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
  } catch {
    // best-effort
  }

  // 4) Procesar el mensaje JSON-RPC.
  const bodyText = await req.text()
  const { status, json } = await handleMcpPost(bodyText, { orgId: key.organizationId, orgName: key.orgName }, CRM_TOOLS)
  if (status === 202) return new Response(null, { status: 202 })
  return Response.json(json, { status })
}

export async function GET() {
  return methodNotAllowed()
}

export async function DELETE() {
  return methodNotAllowed()
}
