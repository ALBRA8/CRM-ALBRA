import { describe, expect, it, beforeAll, afterAll, vi, afterEach } from 'vitest'
import { rememberMessage, recallContext, recallStyleLessons, consolidateMemory } from '@/lib/memory'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'
import { POST as correctionsPOST } from '@/app/api/agent/corrections/route'
import { GET as memoryVectorGET, POST as memoryVectorPOST } from '@/app/api/memory/vector/route'

/**
 * Memoria vectorial (Fase 5) — integración contra BD efímera con el proveedor
 * de embeddings y el LLM mockeados (ningún test habla con un proveedor real).
 *
 * Escenarios:
 * - rememberMessage guarda fragmento con embedding (org-b, fetch mockeado)
 * - rememberMessage degrada a texto sin configuración (org-c)
 * - recallContext rankea semánticamente y degrada a recencia
 * - consolidateMemory crea hechos duraderos y marca fragmentos consolidados
 * - POST /api/agent/corrections: 201 + 404 cross-tenant + 401 sin sesión
 * - GET /api/memory/vector: stats + búsqueda semántica con scores
 */

// Mock parcial de '@/lib/ai': getLLMConfig real (lee Settings de la BD),
// llmChat controlado por test para la consolidación.
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return { ...actual, llmChat: vi.fn() }
})
import { llmChat } from '@/lib/ai'
const mockedLlm = vi.mocked(llmChat)

/** Vectores falsos 3D por tema: 'puerta' → A, 'factura' → B, resto → neutro. */
const VEC_PUERTA = [0.9, 0.1, 0.0]
const VEC_FACTURA = [0.0, 0.1, 0.9]
const VEC_NEUTRO = [0.5, 0.5, 0.0]

function vecFor(text: string): number[] {
  if (text.toLowerCase().includes('puerta')) return VEC_PUERTA
  if (text.toLowerCase().includes('factura')) return VEC_FACTURA
  return VEC_NEUTRO
}

const fetchMock = vi.fn(async (url: unknown, init?: { body?: string }) => {
  const urlStr = String(url)
  if (urlStr.includes('/embeddings')) {
    const body = JSON.parse(init?.body ?? '{}') as { input?: string[] }
    const input = body.input ?? []
    return new Response(JSON.stringify({ data: input.map((t) => ({ embedding: vecFor(t) })) }), { status: 200 })
  }
  return new Response(JSON.stringify({ error: 'unexpected fetch ' + urlStr }), { status: 500 })
})

beforeAll(async () => {
  // org-b: configuración LLM de embeddings (modo vectorial)
  await db.settings.upsert({
    where: { organizationId: FIX.orgB.id },
    create: {
      organizationId: FIX.orgB.id,
      llmBaseUrl: 'http://mock-embed.local/v1',
      llmApiKeyEnc: encryptSecret('test-embed-key'),
      llmEmbedModel: 'test-embed-model',
    },
    update: {
      llmBaseUrl: 'http://mock-embed.local/v1',
      llmApiKeyEnc: encryptSecret('test-embed-key'),
      llmEmbedModel: 'test-embed-model',
    },
  })
  // org-c: cliente propio para probar el modo degradado (sin settings)
  await db.client.upsert({
    where: { id: 'client-c1' },
    create: { id: 'client-c1', organizationId: FIX.orgC.id, name: 'Cliente Org C' },
    update: {},
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  // Limpieza: los fragmentos/hechos/correcciones creados por estos tests
  await db.conversationEmbedding.deleteMany({ where: { organizationId: { in: [FIX.orgB.id, FIX.orgC.id] } } })
  await db.agentCorrection.deleteMany({ where: { organizationId: FIX.orgB.id } })
  await db.agentMemory.deleteMany({ where: { organizationId: FIX.orgB.id, source: 'agent' } })
  await db.client.deleteMany({ where: { id: 'client-c1', organizationId: FIX.orgC.id } })
  // Dejar org-b sin config de embeddings como estaba (los settings vivían vacíos)
  await db.settings.updateMany({
    where: { organizationId: FIX.orgB.id },
    data: { llmBaseUrl: null, llmApiKeyEnc: null, llmEmbedModel: null },
  })
})

describe('rememberMessage', () => {
  it('guarda el fragmento con embedding cuando hay proveedor configurado', async () => {
    vi.stubGlobal('fetch', fetchMock)
    await rememberMessage({
      orgId: FIX.orgB.id,
      clientId: FIX.clientB1.id,
      channel: 'whatsapp',
      role: 'incoming',
      text: 'Hola, quiero cotizar una puerta de madera para mi tienda',
    })
    const row = await db.conversationEmbedding.findFirst({
      where: { organizationId: FIX.orgB.id, clientId: FIX.clientB1.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(row).not.toBeNull()
    expect(row?.text).toContain('puerta de madera')
    expect(row?.embedding).not.toBeNull()
    const parsed = JSON.parse(row!.embedding!) as number[]
    expect(parsed).toEqual(VEC_PUERTA)
  })

  it('degrada a texto sin embedding si la org no tiene configuración (org-c)', async () => {
    vi.stubGlobal('fetch', fetchMock) // ni siquiera debería llamarse
    await rememberMessage({
      orgId: FIX.orgC.id,
      clientId: 'client-c1',
      channel: 'telegram',
      role: 'incoming',
      text: 'Mensaje sin configuración de embeddings',
    })
    const row = await db.conversationEmbedding.findFirst({
      where: { organizationId: FIX.orgC.id, clientId: 'client-c1' },
      orderBy: { createdAt: 'desc' },
    })
    expect(row).not.toBeNull()
    expect(row?.embedding).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignora textos vacíos sin crear filas', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const before = await db.conversationEmbedding.count({ where: { organizationId: FIX.orgC.id } })
    await rememberMessage({ orgId: FIX.orgC.id, clientId: null, channel: 'chat', role: 'incoming', text: '   ' })
    const after = await db.conversationEmbedding.count({ where: { organizationId: FIX.orgC.id } })
    expect(after).toBe(before)
  })
})

describe('recallContext', () => {
  it('rankea semánticamente: la consulta de "puertas" trae el fragmento de puertas primero', async () => {
    vi.stubGlobal('fetch', fetchMock)
    // Segundo fragmento con otro tema para forzar el ranking
    await rememberMessage({
      orgId: FIX.orgB.id,
      clientId: FIX.clientB1.id,
      channel: 'whatsapp',
      role: 'incoming',
      text: 'Necesito una factura con mi NIT para la contabilidad',
    })
    const block = await recallContext({
      orgId: FIX.orgB.id,
      clientId: FIX.clientB1.id,
      query: 'presupuesto de puertas de madera',
    })
    expect(block).toContain('MEMORIA DE CONVERSACIONES ANTERIORES')
    const puertIdx = block.indexOf('puerta de madera')
    const facturaIdx = block.indexOf('factura con mi NIT')
    expect(puertIdx).toBeGreaterThan(-1)
    expect(facturaIdx).toBeGreaterThan(-1)
    // El fragmento semánticamente más cercano aparece ANTES en el bloque
    expect(puertIdx).toBeLessThan(facturaIdx)
  })

  it('degrada a recencia con la org sin embeddings (org-c) y aislamiento multi-tenant', async () => {
    await rememberMessage({
      orgId: FIX.orgC.id,
      clientId: 'client-c1',
      channel: 'telegram',
      role: 'incoming',
      text: 'Segundo mensaje sin embeddings para recencia',
    })
    const block = await recallContext({ orgId: FIX.orgC.id, clientId: 'client-c1', query: 'lo que sea' })
    expect(block).toContain('MEMORIA DE CONVERSACIONES ANTERIORES')
    expect(block).toContain('Mensaje sin configuración de embeddings')
    // aislamiento: nada de org-b se filtra en org-c
    expect(block).not.toContain('puerta de madera')
  })

  it('devuelve "" si el cliente no tiene fragmentos (no ensucia el prompt)', async () => {
    const block = await recallContext({ orgId: FIX.orgA.id, clientId: 'client-inexistente', query: 'x' })
    expect(block).toBe('')
  })
})

describe('consolidateMemory', () => {
  it('resume fragmentos pendientes en hechos duraderos, deduplica y marca consolidados', async () => {
    vi.stubGlobal('fetch', fetchMock)
    // 5 fragmentos pendientes para org-b/clientB1 (ya hay 2 de los tests previos:
    // puerta + factura). Creamos 3 más con el mismo cliente.
    const extra = [
      '¿Tienen entrega los sábados en la mañana?',
      'Prefiero que me escriban en la tarde después de las 3',
      'El local de mi tienda está en el centro',
    ]
    for (const t of extra) {
      await rememberMessage({ orgId: FIX.orgB.id, clientId: FIX.clientB1.id, channel: 'whatsapp', role: 'incoming', text: t })
    }
    const pendingBefore = await db.conversationEmbedding.count({
      where: { organizationId: FIX.orgB.id, clientId: FIX.clientB1.id, consolidated: false },
    })
    expect(pendingBefore).toBeGreaterThanOrEqual(4)

    mockedLlm.mockResolvedValueOnce(
      JSON.stringify({
        facts: [
          'El cliente quiere cotizar una puerta de madera para su tienda',
          'El cliente prefiere recibir mensajes en la tarde después de las 3',
          'El cliente pregunta por entregas los sábados',
        ],
      })
    )
    const created = await consolidateMemory({ orgId: FIX.orgB.id, clientId: FIX.clientB1.id })
    expect(created).toBeGreaterThan(0)

    const facts = await db.agentMemory.findMany({
      where: { organizationId: FIX.orgB.id, source: 'agent', clientId: FIX.clientB1.id },
    })
    expect(facts.length).toBe(created)
    for (const f of facts) {
      expect(f.key).toBe('fact')
      expect(f.embedding).not.toBeNull()
    }
    // Todos los fragmentos del cliente quedaron consolidados
    const pendingAfter = await db.conversationEmbedding.count({
      where: { organizationId: FIX.orgB.id, clientId: FIX.clientB1.id, consolidated: false },
    })
    expect(pendingAfter).toBe(0)

    mockedLlm.mockReset()
  })

  it('devuelve 0 si no hay suficientes fragmentos pendientes (mínimo 4)', async () => {
    const created = await consolidateMemory({ orgId: FIX.orgA.id, clientId: FIX.clientA2.id })
    expect(created).toBe(0)
  })
})

describe('POST /api/agent/corrections', () => {
  it('201: guarda la lección de estilo con embedding (auto-mejora)', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const res = await correctionsPOST(
      req('/api/agent/corrections', {
        method: 'POST',
        token: tokenB(),
        body: {
          original: 'Hola, ¿quieres cotizar?',
          final: 'Buenos días, ¿te ayudo con una cotización de puertas?',
          clientId: FIX.clientB1.id,
          channel: 'whatsapp',
        },
      })
    )
    expect(res.status).toBe(201)
    const row = await db.agentCorrection.findFirst({
      where: { organizationId: FIX.orgB.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(row?.final).toContain('Buenos días')
    expect(row?.embedding).not.toBeNull()
  })

  it('la lección se recalla semánticamente en recallStyleLessons', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const block = await recallStyleLessons({
      orgId: FIX.orgB.id,
      clientId: FIX.clientB1.id,
      query: 'saludo para cotización de puertas',
    })
    expect(block).toContain('LECCIONES DE ESTILO DEL VENDEDOR')
    expect(block).toContain('Buenos días')
  })

  it('404: clientId de otra organización (aislamiento multi-tenant)', async () => {
    const res = await correctionsPOST(
      req('/api/agent/corrections', {
        method: 'POST',
        token: tokenB(),
        body: { original: 'a', final: 'b', clientId: FIX.clientA1.id },
      })
    )
    expect(res.status).toBe(404)
  })

  it('401: sin token no pasa', async () => {
    const res = await correctionsPOST(
      req('/api/agent/corrections', { method: 'POST', body: { original: 'a', final: 'b' } })
    )
    expect(res.status).toBe(401)
  })
})

describe('GET/POST /api/memory/vector', () => {
  it('GET sin q: devuelve stats del modo vectorial', async () => {
    const res = await memoryVectorGET(req('/api/memory/vector', { token: tokenB() }))
    expect(res.status).toBe(200)
    const data = (await jsonBody(res)) as { stats: { fragments: number; withVectors: number; vectorMode: boolean } }
    expect(data.stats.fragments).toBeGreaterThan(0)
    expect(data.stats.withVectors).toBeGreaterThan(0)
    expect(data.stats.vectorMode).toBe(true)
  })

  it('GET con q: búsqueda semántica con scores ordenados', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const res = await memoryVectorGET(req('/api/memory/vector?q=puertas%20de%20madera&clientId=' + FIX.clientB1.id, { token: tokenB() }))
    expect(res.status).toBe(200)
    const data = (await jsonBody(res)) as { results: Array<{ text: string; score: number | null }> }
    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results[0].text).toContain('puerta')
    if (data.results.length > 1 && data.results[0].score !== null && data.results[1].score !== null) {
      expect(data.results[0].score).toBeGreaterThanOrEqual(data.results[1].score)
    }
  })

  it('POST: consolidación manual responde 200 con newFacts', async () => {
    vi.stubGlobal('fetch', fetchMock)
    mockedLlm.mockResolvedValueOnce(JSON.stringify({ facts: [] }))
    const res = await memoryVectorPOST(req('/api/memory/vector', { method: 'POST', token: tokenB(), body: {} }))
    expect(res.status).toBe(200)
    const data = (await jsonBody(res)) as { success: boolean; newFacts: number }
    expect(data.success).toBe(true)
    expect(data.newFacts).toBe(0)
    mockedLlm.mockReset()
  })
})
