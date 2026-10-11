import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { generateApiKey } from '@/lib/api-keys'
import { POST as mcpPost, GET as mcpGet } from '@/app/api/mcp/route'
import { FIX } from '../setup/seed-data'

/**
 * Tests de integración del endpoint /api/mcp (Task 27):
 * autenticación por API key, aislamiento multi-tenant de las herramientas,
 * ciclo initialize → tools/list → tools/call y bordes del transporte.
 * La BD es la efímera de Vitest (db/test-vitest.db) sembrada por el setup.
 */

const BASE_URL = 'http://localhost:3000/api/mcp'

let keyA: string
let keyB: string
let keyARevoked: string

async function post(body: unknown, opts: { key?: string | null; protocolVersion?: string } = {}): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (opts.key) headers.set('Authorization', `Bearer ${opts.key}`)
  if (opts.protocolVersion) headers.set('MCP-Protocol-Version', opts.protocolVersion)
  return mcpPost(
    new NextRequest(BASE_URL, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

function rpc(id: number | string, method: string, params?: unknown) {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }
}

beforeAll(async () => {
  const a = generateApiKey()
  const b = generateApiKey()
  const r = generateApiKey()
  keyA = a.raw
  keyB = b.raw
  keyARevoked = r.raw
  await db.apiKey.createMany({
    data: [
      { organizationId: FIX.orgA.id, name: 'Claude (org A)', hashedKey: a.hashedKey, prefix: a.prefix },
      { organizationId: FIX.orgB.id, name: 'Cursor (org B)', hashedKey: b.hashedKey, prefix: b.prefix },
      { organizationId: FIX.orgA.id, name: 'Revocada (org A)', hashedKey: r.hashedKey, prefix: r.prefix, revokedAt: new Date() },
    ],
  })
})

describe('autenticación', () => {
  it('401 sin cabecera Authorization', async () => {
    const res = await post(rpc(1, 'ping'), { key: null })
    expect(res.status).toBe(401)
  })

  it('401 con clave desconocida', async () => {
    const res = await post(rpc(1, 'ping'), { key: 'albra_' + '0'.repeat(48) })
    expect(res.status).toBe(401)
  })

  it('401 con clave revocada', async () => {
    const res = await post(rpc(1, 'ping'), { key: keyARevoked })
    expect(res.status).toBe(401)
  })

  it('400 con MCP-Protocol-Version no soportada (aun autenticado)', async () => {
    const res = await post(rpc(1, 'ping'), { key: keyA, protocolVersion: '2020-01-01' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toContain('no soportada')
  })
})

describe('transporte', () => {
  it('GET → 405 (sin stream SSE en modo stateless)', async () => {
    const res = await mcpGet()
    expect(res.status).toBe(405)
  })

  it('JSON malformado → 400 PARSE_ERROR', async () => {
    const res = await post('{oops', { key: keyA })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe(-32700)
  })

  it('notificación (sin id) → 202 sin cuerpo', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { key: keyA })
    expect(res.status).toBe(202)
  })
})

describe('handshake MCP', () => {
  it('initialize devuelve serverInfo y versión negociada', async () => {
    const res = await post(rpc('i1', 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '0' } }), { key: keyA })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.serverInfo.name).toBe('albra-crm')
    expect(body.result.capabilities.tools).toBeTruthy()
  })

  it('tools/list expone las 15 herramientas del CRM con inputSchema', async () => {
    const res = await post(rpc(2, 'tools/list'), { key: keyA })
    const body = await res.json()
    const names: string[] = body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'list_clients',
        'create_client',
        'get_client',
        'add_client_note',
        'list_pipeline_stages',
        'list_opportunities',
        'create_opportunity',
        'update_opportunity',
        'list_quotes',
        'get_quote',
        'list_conversations',
        'get_conversation',
        'send_whatsapp',
        'list_knowledge',
        'get_dashboard_stats',
      ])
    )
    for (const t of body.result.tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(typeof t.description).toBe('string')
    }
  })

  it('ping responde vacío', async () => {
    const res = await post(rpc(3, 'ping'), { key: keyA })
    const body = await res.json()
    expect(body.result).toEqual({})
  })
})

describe('herramientas con aislamiento multi-tenant', () => {
  it('list_clients (org A) ve SOLO clientes de la org A', async () => {
    const res = await post(rpc(4, 'tools/call', { name: 'list_clients', arguments: { limit: 50 } }), { key: keyA })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(false)
    const text = body.result.content[0].text
    expect(text).toContain('Cliente Alpha')
    expect(text).not.toContain('Cliente Beta Org B')
  })

  it('list_clients (org B) ve SOLO clientes de la org B', async () => {
    const res = await post(rpc(5, 'tools/call', { name: 'list_clients', arguments: { limit: 50 } }), { key: keyB })
    const body = await res.json()
    const text = body.result.content[0].text
    expect(text).toContain('Cliente Beta Org B')
    expect(text).not.toContain('Cliente Alpha')
  })

  it('create_client crea en la org de la clave, con timeline, y queda visible para get_client', async () => {
    const res = await post(
      rpc(6, 'tools/call', {
        name: 'create_client',
        arguments: { name: 'Cliente MCP', phone: '+57 310 000 0000', email: 'mcp@test.albra' },
      }),
      { key: keyA }
    )
    const body = await res.json()
    expect(body.result.isError).toBe(false)
    const created = body.result.structuredContent.client
    expect(created.id).toBeTruthy()

    const row = await db.client.findFirst({ where: { id: created.id, organizationId: FIX.orgA.id } })
    expect(row?.name).toBe('Cliente MCP')
    expect(row?.source).toBe('api')

    // Trazabilidad: timeline + auditoría con huella MCP
    const timeline = await db.timelineEvent.findFirst({ where: { clientId: created.id, organizationId: FIX.orgA.id } })
    expect(timeline?.title).toContain('vía MCP')

    // Round-trip: get_client lo encuentra; una clave de org B NO
    const ok = await post(rpc(7, 'tools/call', { name: 'get_client', arguments: { clientId: created.id } }), { key: keyA })
    expect((await ok.json()).result.structuredContent.client.name).toBe('Cliente MCP')
    const cross = await post(rpc(8, 'tools/call', { name: 'get_client', arguments: { clientId: created.id } }), { key: keyB })
    const crossBody = await cross.json()
    expect(crossBody.result.isError).toBe(true)
    expect(crossBody.result.content[0].text).toContain('no encontrado')
  })

  it('create_client sin teléfono → isError con mensaje claro', async () => {
    const res = await post(rpc(9, 'tools/call', { name: 'create_client', arguments: { name: 'Sin Teléfono' } }), { key: keyA })
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('phone')
  })

  it('herramienta desconocida → error JSON-RPC -32602', async () => {
    const res = await post(rpc(10, 'tools/call', { name: 'borrar_todo', arguments: {} }), { key: keyA })
    const body = await res.json()
    expect(body.error?.code).toBe(-32602)
  })

  it('update_opportunity sobre id ajeno → isError', async () => {
    const res = await post(rpc(11, 'tools/call', { name: 'update_opportunity', arguments: { opportunityId: 'inexistente', status: 'won' } }), { key: keyA })
    const body = await res.json()
    expect(body.result.isError).toBe(true)
  })

  it('get_dashboard_stats devuelve contadores de la org', async () => {
    const res = await post(rpc(12, 'tools/call', { name: 'get_dashboard_stats', arguments: {} }), { key: keyA })
    const body = await res.json()
    const stats = body.result.structuredContent
    expect(stats.clients).toBeGreaterThanOrEqual(2)
    expect(typeof stats.pipelineValueOpen).toBe('number')
  })
})
