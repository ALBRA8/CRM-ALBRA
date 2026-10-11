/**
 * CRM ALBRA — Núcleo del Servidor MCP (Model Context Protocol), Task 27.
 *
 * Implementación STATELESS de JSON-RPC 2.0 sobre el transporte "Streamable
 * HTTP" de MCP (spec 2025-03-26 / 2025-06-18), SIN dependencias externas:
 *   - El cliente hace POST con UN mensaje JSON-RPC y el servidor responde
 *     con application/json (permitido para respuestas no streaming).
 *   - Las notificaciones (sin `id`) responden 202 sin cuerpo — lo decide la
 *     ruta HTTP; aquí solo devolvemos null.
 *   - GET/DELETE devuelven 405 (el servidor no ofrece stream SSE ni sesiones).
 *
 * Este archivo NO importa Next ni Prisma: es puro para testear. El registro
 * de herramientas se inyecta (por defecto, las del CRM en tools.ts).
 */

// ---------- Versiones del protocolo ----------

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

/**
 * Eco de la versión del cliente si la soportamos; si no (o si no vino),
 * negociamos la más reciente que hablamos (spec: el servidor responde con
 * LA versión que usará).
 */
export function negotiateVersion(requested: unknown): string {
  if (typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested
  }
  return LATEST_PROTOCOL_VERSION
}

// ---------- Tipos JSON-RPC ----------

export type JsonRpcId = string | number | null

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

// ---------- Contexto y herramientas ----------

/** Contexto del tenant resuelto desde la API key autenticada. */
export interface McpContext {
  orgId: string
  orgName: string
}

export interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** Devuelve un payload serializable; lanzar = resultado isError para el cliente. */
  handler(args: Record<string, unknown>, ctx: McpContext): Promise<unknown>
}

export interface McpServerInfo {
  name: string
  title: string
  version: string
}

export const SERVER_INFO: McpServerInfo = {
  name: 'albra-crm',
  title: 'CRM ALBRA',
  version: '0.3.0',
}

const SERVER_INSTRUCTIONS = [
  'Servidor MCP de CRM ALBRA: todas las herramientas operan SOLO sobre la organización',
  'de la API key usada (aislamiento multi-tenant).',
  'Flujo comercial típico: buscar/crear clientes (list_clients, create_client), avanzar el',
  'pipeline (list_pipeline_stages, create_opportunity, update_opportunity), cotizar',
  '(list_quotes, get_quote) y contactar por WhatsApp (send_whatsapp, requiere el daemon',
  'de WhatsApp conectado). add_client_note deja huella en el historial del cliente.',
].join(' ')

// ---------- Manejador principal ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Procesa UN mensaje JSON-RPC y devuelve la respuesta, o null si es una
 * notificación (el transporte debe responder 202 sin cuerpo).
 * `tools` es inyectable para tests; por defecto usa las del CRM.
 */
export async function handleMcpMessage(
  raw: unknown,
  ctx: McpContext,
  tools: McpTool[]
): Promise<JsonRpcResponse | null> {
  if (!isRecord(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string') {
    return errorResponse(null, ERROR_CODES.INVALID_REQUEST, 'Mensaje JSON-RPC 2.0 inválido')
  }

  const method = raw.method
  const id = raw.id === undefined ? null : (raw.id as JsonRpcId)
  const params = isRecord(raw.params) ? raw.params : {}

  // Notificaciones (sin `id`): el servidor NUNCA responde (spec JSON-RPC y MCP).
  if (raw.id === undefined) {
    return null
  }

  switch (method) {
    case 'initialize': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        },
      }
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        },
      }

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : null
      if (!name) {
        return errorResponse(id, ERROR_CODES.INVALID_PARAMS, 'tools/call requiere el nombre de la herramienta')
      }
      const tool = tools.find((t) => t.name === name)
      if (!tool) {
        return errorResponse(id, ERROR_CODES.INVALID_PARAMS, `Herramienta desconocida: ${name}`, {
          available: tools.map((t) => t.name),
        })
      }
      const args = isRecord(params.arguments) ? params.arguments : {}
      try {
        const data = await tool.handler(args, ctx)
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
            isError: false,
          },
        }
      } catch (err) {
        // Errores de NEGOCIO (validación, no encontrado, canal caído): la spec
        // MCP los modela como result.isError, no como error JSON-RPC.
        const message = err instanceof Error ? err.message : 'Error ejecutando la herramienta'
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${message}` }],
            isError: true,
          },
        }
      }
    }

    // Cortesía: los clientes suelen preguntar aunque no anunciemos capacidades.
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } }

    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } }

    default:
      return errorResponse(id, ERROR_CODES.METHOD_NOT_FOUND, `Método no soportado: ${method}`)
  }
}

/**
 * Parsea el cuerpo crudo del POST y procesa el mensaje (o lote de mensajes).
 * Devuelve la respuesta HTTP lista: 200 JSON, 202 (solo notificaciones) o
 * 400 con error de parseo. La autenticación la resuelve la ruta ANTES de aquí.
 */
export async function handleMcpPost(
  bodyText: string,
  ctx: McpContext,
  tools: McpTool[]
): Promise<{ status: number; json: unknown }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return { status: 400, json: errorResponse(null, ERROR_CODES.PARSE_ERROR, 'Cuerpo JSON inválido') }
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { status: 400, json: errorResponse(null, ERROR_CODES.INVALID_REQUEST, 'Lote vacío') }
    }
    const responses: JsonRpcResponse[] = []
    for (const msg of parsed) {
      const res = await handleMcpMessage(msg, ctx, tools)
      if (res) responses.push(res)
    }
    // Si el lote era solo notificaciones → 202 sin cuerpo.
    return responses.length ? { status: 200, json: responses } : { status: 202, json: null }
  }

  const response = await handleMcpMessage(parsed, ctx, tools)
  if (!response) return { status: 202, json: null }
  return { status: 200, json: response }
}
