import { describe, expect, it, beforeAll, vi } from 'vitest'
import { POST as aiSuggestPOST } from '@/app/api/opportunities/[id]/ai-suggest/route'
import { db } from '@/lib/db'
import { llmChat } from '@/lib/ai'
import { FIX, jsonBody, req, routeParams, tokenA, tokenB } from '../helpers'

/**
 * IA de cierre (Fase 4) — integración del endpoint POST /api/opportunities/:id/ai-suggest
 * contra BD efímera, con el proveedor LLM mockeado (mismo espíritu que el mock
 * global de workflow-engine: ningún test habla con un LLM real).
 *
 * Escenarios: 401 sin sesión · 200 happy path (JSON válido del LLM + canales
 * disponibles del cliente) · 404 cross-tenant · 502 respuesta inválida ·
 * 503 sin proveedor · 403 con el toggle dealAiEnabled desactivado.
 */

// Mock parcial: extractJson real (parser fail-closed), llmChat controlado por test.
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return { ...actual, llmChat: vi.fn() }
})

const mockedLlm = vi.mocked(llmChat)

const OPP_A = 'opp-ai-a'
const OPP_B = 'opp-ai-b'

const VALID_LLM_JSON = JSON.stringify({
  probability: 78,
  nextBestAction: 'Enviar el seguimiento de la propuesta hoy mismo',
  suggestedMessage: 'Hola Ana, ¿pudiste revisar la propuesta? Quedo atento a tus comentarios para agendar la implementación.',
  reasoning: 'Cotización enviada y cliente activo en los últimos días.',
})

beforeAll(async () => {
  // Etapa + oportunidad org-a (con cliente, cotización y timeline)
  const stage = await db.pipelineStage.create({
    data: { id: 'stage-ai-a', organizationId: FIX.orgA.id, name: 'Oferta', order: 3, probability: 0.5 },
  })
  await db.opportunity.create({
    data: {
      id: OPP_A,
      organizationId: FIX.orgA.id,
      title: 'Implementación CRM Alfa',
      clientId: FIX.clientA1.id,
      stageId: stage.id,
      amount: 5000,
      currency: 'USD',
      notes: JSON.stringify({ text: 'Quiere automatizar WhatsApp', interest: 'Automatización', nextAction: 'Enviar propuesta' }),
    },
  })
  await db.quote.create({
    data: {
      organizationId: FIX.orgA.id,
      number: 'Q-AI-001',
      clientId: FIX.clientA1.id,
      opportunityId: OPP_A,
      total: 5000,
      currency: 'USD',
      status: 'sent',
    },
  })
  await db.timelineEvent.create({
    data: {
      organizationId: FIX.orgA.id,
      clientId: FIX.clientA1.id,
      opportunityId: OPP_A,
      type: 'whatsapp',
      title: 'Cliente preguntó por precios',
      source: 'integration',
    },
  })
  // Canales del cliente para la respuesta channels[] del endpoint:
  // conversación activa de WhatsApp (daemon) + hilo Telegram con chatId.
  await db.whatsAppConversation.create({
    data: {
      organizationId: FIX.orgA.id,
      clientId: FIX.clientA1.id,
      contactPhone: '+573001110000',
      contactName: 'Cliente Alpha WA',
      lastMessage: '¿Me pasas la propuesta?',
      lastMessageAt: new Date('2026-01-12T10:00:00Z'),
      lastMessageFrom: 'in',
    },
  })
  await db.timelineEvent.create({
    data: {
      organizationId: FIX.orgA.id,
      clientId: FIX.clientA1.id,
      type: 'telegram',
      title: 'tg in',
      description: 'Pregunta por Telegram',
      metadata: JSON.stringify({ chatId: '555099', direction: 'in' }),
      source: 'integration',
    },
  })

  // Oportunidad de org-b (para verificar aislamiento cross-tenant)
  await db.opportunity.create({
    data: { id: OPP_B, organizationId: FIX.orgB.id, title: 'Oportunidad Beta', amount: 1000 },
  })
})

describe('POST /api/opportunities/:id/ai-suggest — auth y scope', () => {
  it('sin sesión → 401', async () => {
    const res = await aiSuggestPOST(req(`/api/opportunities/${OPP_A}`, { method: 'POST' }), routeParams(OPP_A))
    expect(res.status).toBe(401)
  })

  it('oportunidad de otra organización → 404 (sin filtrar datos)', async () => {
    const res = await aiSuggestPOST(req(`/api/opportunities/${OPP_A}`, { method: 'POST', token: tokenB() }), routeParams(OPP_A))
    expect(res.status).toBe(404)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/Oportunidad no encontrada/)
  })
})

describe('POST /api/opportunities/:id/ai-suggest — generación con LLM mockeado', () => {
  it('happy path: 200 con la sugerencia normalizada y llamada en modo JSON', async () => {
    mockedLlm.mockResolvedValueOnce(VALID_LLM_JSON)
    const res = await aiSuggestPOST(req(`/api/opportunities/${OPP_A}`, { method: 'POST', token: tokenA() }), routeParams(OPP_A))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.suggestion).toMatchObject({
      probability: 78,
      nextBestAction: 'Enviar el seguimiento de la propuesta hoy mismo',
      reasoning: 'Cotización enviada y cliente activo en los últimos días.',
    })
    expect(String((body.suggestion as { suggestedMessage: string }).suggestedMessage)).toContain('propuesta')
    // El prompt pide jsonMode (response_format) y el contexto de la org
    expect(mockedLlm).toHaveBeenCalledTimes(1)
    const [orgId, messages, opts] = mockedLlm.mock.calls[0]
    expect(orgId).toBe(FIX.orgA.id)
    expect(opts?.jsonMode).toBe(true)
    const userMsg = messages.find((m) => m.role === 'user')
    expect(String(userMsg?.content)).toContain('Implementación CRM Alfa')
    expect(String(userMsg?.content)).toContain('sent · USD 5000') // cotización incluida en el contexto
    // Canales del cliente con conversación activa (para "Enviar por …")
    const channels = body.channels as Array<{ key: string; channel: string; channelLabel: string; contactHandle: string }>
    expect(channels.map((c) => c.channelLabel).sort()).toEqual(['Telegram', 'WhatsApp'])
    expect(channels.find((c) => c.channel === 'whatsapp')?.key).toMatch(/^wa:/)
    expect(channels.find((c) => c.channel === 'whatsapp')?.contactHandle).toBe('+573001110000')
    expect(channels.find((c) => c.channel === 'telegram')?.key).toBe(`tg:${FIX.clientA1.id}`)
    expect(channels.find((c) => c.channel === 'telegram')?.contactHandle).toBe('555099')
  })

  it('respuesta basura del LLM → 502 descriptivo (nunca 500 críptico)', async () => {
    mockedLlm.mockResolvedValueOnce('Perdón, no tengo información suficiente.')
    const res = await aiSuggestPOST(req(`/api/opportunities/${OPP_A}`, { method: 'POST', token: tokenA() }), routeParams(OPP_A))
    expect(res.status).toBe(502)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/formato válido/i)
  })

  it('sin proveedor LLM disponible → 503 con el mensaje claro de la capa de IA', async () => {
    mockedLlm.mockRejectedValueOnce(new Error('No hay proveedor de IA disponible. Configura tu LLM (OpenAI/Groq/compatible) en Configuración → Agente IA.'))
    const res = await aiSuggestPOST(req(`/api/opportunities/${OPP_A}`, { method: 'POST', token: tokenA() }), routeParams(OPP_A))
    expect(res.status).toBe(503)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/proveedor de IA/i)
  })

  it('toggle dealAiEnabled=false → 403 (IA desactivada por la organización)', async () => {
    await db.settings.upsert({
      where: { organizationId: FIX.orgA.id },
      create: { organizationId: FIX.orgA.id, dealAiEnabled: false },
      update: { dealAiEnabled: false },
    })
    try {
      const res = await aiSuggestPOST(req(`/api/opportunities/${OPP_A}`, { method: 'POST', token: tokenA() }), routeParams(OPP_A))
      expect(res.status).toBe(403)
      const body = await jsonBody(res)
      expect(String(body.error)).toMatch(/desactivada/i)
      expect(mockedLlm).not.toHaveBeenCalled() // ni siquiera intenta llamar al LLM
    } finally {
      // restaurar para no contaminar otros archivos (la BD se recrea por archivo,
      // pero dejamos el estado consistente dentro del archivo)
      await db.settings.upsert({
        where: { organizationId: FIX.orgA.id },
        create: { organizationId: FIX.orgA.id, dealAiEnabled: true },
        update: { dealAiEnabled: true },
      })
    }
  })
})
