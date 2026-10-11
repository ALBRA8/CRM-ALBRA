import { describe, it, expect } from 'vitest'
import {
  handleMcpMessage,
  handleMcpPost,
  negotiateVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
  LATEST_PROTOCOL_VERSION,
  ERROR_CODES,
  SERVER_INFO,
  type McpTool,
} from '@/lib/mcp/protocol'
import { generateApiKey, hashApiKey, API_KEY_PREFIX } from '@/lib/api-keys'
import { createHash } from 'crypto'

/**
 * Tests unitarios del núcleo del Servidor MCP (Task 27):
 * protocolo JSON-RPC stateless puro con registro de herramientas INYECTADO
 * (sin tocar la BD) + generación/hashing de API keys.
 */

const CTX = { orgId: 'org-a', orgName: 'Organización Alfa (tests)' }

function echoTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: 'echo',
    description: 'Devuelve lo que recibe (tool de prueba)',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    handler: async (args) => ({ echoed: args.text ?? null }),
    ...overrides,
  }
}

describe('negotiateVersion', () => {
  it('hace eco de una versión soportada', () => {
    expect(negotiateVersion('2024-11-05')).toBe('2024-11-05')
    expect(negotiateVersion('2025-03-26')).toBe('2025-03-26')
  })

  it('negocia la más reciente ante versión desconocida o ausente', () => {
    expect(negotiateVersion('1999-01-01')).toBe(LATEST_PROTOCOL_VERSION)
    expect(negotiateVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION)
    expect(negotiateVersion(42)).toBe(LATEST_PROTOCOL_VERSION)
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(LATEST_PROTOCOL_VERSION)
  })
})

describe('handleMcpMessage — validación del mensaje', () => {
  it('rechaza payloads que no son JSON-RPC 2.0', async () => {
    for (const bad of [null, 42, 'hola', {}, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }]) {
      const res = await handleMcpMessage(bad, CTX, [])
      expect(res?.error?.code).toBe(ERROR_CODES.INVALID_REQUEST)
    }
  })

  it('las notificaciones (sin id) no producen respuesta', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, CTX, [])).toBeNull()
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'echo' } }, CTX, [echoTool()])).toBeNull()
  })

  it('método desconocido → METHOD_NOT_FOUND', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 7, method: 'completions/generate' }, CTX, [])
    expect(res?.error?.code).toBe(ERROR_CODES.METHOD_NOT_FOUND)
    expect(res?.id).toBe(7)
  })
})

describe('handleMcpMessage — métodos del ciclo de vida', () => {
  it('initialize devuelve versión negociada, capabilities y serverInfo', async () => {
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', id: 'init-1', method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      CTX,
      []
    )
    const result = res?.result as Record<string, unknown>
    expect(result.protocolVersion).toBe('2025-03-26')
    expect((result.capabilities as Record<string, unknown>).tools).toBeTruthy()
    expect(result.serverInfo).toMatchObject({ name: SERVER_INFO.name, title: SERVER_INFO.title })
    expect(typeof result.instructions).toBe('string')
    expect(result.instructions).toContain('multi-tenant')
  })

  it('ping responde objeto vacío', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }, CTX, [])
    expect(res?.result).toEqual({})
  })

  it('resources/list y prompts/list responden vacíos (cortesía)', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, CTX, [])
    expect((res?.result as Record<string, unknown>).resources).toEqual([])
    const res2 = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'prompts/list' }, CTX, [])
    expect((res2?.result as Record<string, unknown>).prompts).toEqual([])
  })
})

describe('handleMcpMessage — herramientas', () => {
  it('tools/list expone nombre, descripción y inputSchema', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, CTX, [echoTool()])
    const tools = (res?.result as { tools: Array<Record<string, unknown>> }).tools
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: 'echo', description: 'Devuelve lo que recibe (tool de prueba)' })
    expect(tools[0].inputSchema).toMatchObject({ type: 'object' })
  })

  it('tools/call ejecuta y envuelve el resultado con content + structuredContent', async () => {
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hola' } } },
      CTX,
      [echoTool()]
    )
    const result = res?.result as Record<string, unknown>
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual({ echoed: 'hola' })
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual({ echoed: 'hola' })
  })

  it('tools/call con handler que lanza → result.isError (no error JSON-RPC)', async () => {
    const boom = echoTool({ handler: async () => { throw new Error('canal caído') } })
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: {} } },
      CTX,
      [boom]
    )
    const result = res?.result as Record<string, unknown>
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ text: string }>)[0].text).toContain('canal caído')
    expect(res?.error).toBeUndefined()
  })

  it('tools/call de herramienta desconocida → INVALID_PARAMS con listado disponible', async () => {
    const res = await handleMcpMessage(
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'no_existe', arguments: {} } },
      CTX,
      [echoTool()]
    )
    expect(res?.error?.code).toBe(ERROR_CODES.INVALID_PARAMS)
    expect((res?.error?.data as { available: string[] }).available).toEqual(['echo'])
  })

  it('tools/call sin nombre → INVALID_PARAMS', async () => {
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} }, CTX, [echoTool()])
    expect(res?.error?.code).toBe(ERROR_CODES.INVALID_PARAMS)
  })

  it('arguments ausentes llegan como objeto vacío al handler', async () => {
    const seen: Array<Record<string, unknown>> = []
    const spy = echoTool({ handler: async (args) => { seen.push(args); return null } })
    await handleMcpMessage({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'echo' } }, CTX, [spy])
    expect(seen[0]).toEqual({})
  })
})

describe('handleMcpPost — transporte HTTP', () => {
  const TOOLS = [echoTool()]

  it('JSON inválido → 400 con PARSE_ERROR', async () => {
    const out = await handleMcpPost('{no soy json', CTX, TOOLS)
    expect(out.status).toBe(400)
    expect((out.json as { error: { code: number } }).error.code).toBe(ERROR_CODES.PARSE_ERROR)
  })

  it('mensaje único → 200 con la respuesta', async () => {
    const out = await handleMcpPost(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), CTX, TOOLS)
    expect(out.status).toBe(200)
    expect((out.json as { result: unknown }).result).toEqual({})
  })

  it('lote mixto → 200 con solo las respuestas (las notificaciones se descartan)', async () => {
    const batch = [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]
    const out = await handleMcpPost(JSON.stringify(batch), CTX, TOOLS)
    expect(out.status).toBe(200)
    expect(Array.isArray(out.json)).toBe(true)
    expect(out.json).toHaveLength(1)
  })

  it('lote solo de notificaciones → 202', async () => {
    const out = await handleMcpPost(
      JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }]),
      CTX,
      TOOLS
    )
    expect(out.status).toBe(202)
  })

  it('lote vacío → 400', async () => {
    const out = await handleMcpPost('[]', CTX, TOOLS)
    expect(out.status).toBe(400)
  })
})

describe('API keys — generación y hashing', () => {
  it('la clave cruda tiene el formato albra_<48 hex> y es única', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.raw).toMatch(/^albra_[0-9a-f]{48}$/)
    expect(b.raw).not.toBe(a.raw)
    expect(API_KEY_PREFIX).toBe('albra')
  })

  it('el hash es SHA-256 determinista y no revela la clave', () => {
    const { raw, hashedKey } = generateApiKey()
    expect(hashApiKey(raw)).toBe(hashedKey)
    expect(hashApiKey(raw)).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(hashedKey).not.toContain(raw)
    expect(hashedKey).toMatch(/^[0-9a-f]{64}$/)
    expect(raw.startsWith('albra_')).toBe(true)
  })
})
