import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as autoReplyPOST } from '@/app/api/whatsapp/auto-reply/route'
import { llmReplyOrNotification } from '@/lib/channel-autoresponder'
import { SALES_STRATEGY_PROMPT } from '@/lib/prompts/sales-strategy'
import { db } from '@/lib/db'
import { llmChat } from '@/lib/ai'
import { FIX } from '../helpers'

/**
 * CAPA DE ESTRATEGIA COMERCIAL CONSULTIVA (canales WhatsApp/Instagram/Telegram/Chat).
 * Verifica la inyección de SALES_STRATEGY_PROMPT en el system prompt de todos los
 * canales conversacionales, junto al contexto dinámico del cliente (KB + memoria).
 *
 * Criterios de aceptación contractuales:
 *  - Marcadores tácticos presentes: DIAGNÓSTICO ANTES DEL PRECIO, CONTRASTE DE
 *    VALOR, MANEJO DE OBJECIONES, CIERRE ACTIVO; prohibición de cierres pasivos.
 *  - Contratos previos intactos: el canal WhatsApp sigue hablando a CLIENTES
 *    finales y SIN herramientas de CRM (esas viven en /api/crm/actions).
 *  - La estrategia va ANTES del contexto del cliente (orden rol → táctica → datos).
 *  - La prueba de calificación REAL con LLM ("Precio" → contextualiza y
 *    contrapregunta) se ejecuta como smoke manual contra el servidor vivo.
 */

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return { ...actual, llmChat: vi.fn() }
})

const mockedLlm = vi.mocked(llmChat)

const SECRET = 'internal-test-secret-0123456789abcdef'
const CLIENT_ESTRATEGIA = 'client-estrategia-wa'

function internalReq(body: Record<string, unknown>, headers: Record<string, string> = { 'x-internal-secret': SECRET }): NextRequest {
  return new NextRequest('http://localhost:3000/api/whatsapp/auto-reply', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  vi.stubEnv('INTERNAL_API_SECRET', SECRET)
  await db.client.create({
    data: { id: CLIENT_ESTRATEGIA, organizationId: FIX.orgA.id, name: 'Cliente Estrategia', phone: '+57 320 777 0000' },
  })
  await db.nichoConfig.upsert({
    where: { organizationId: FIX.orgA.id },
    create: { organizationId: FIX.orgA.id, autoReplyEnabled: true, handoffKeywords: JSON.stringify(['hablar con un humano']) },
    update: { autoReplyEnabled: true },
  })
  mockedLlm.mockReset()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('SALES_STRATEGY_PROMPT — directriz comercial consultiva', () => {
  it('contiene las 4 directrices tácticas y prohíbe cierres pasivos', () => {
    expect(SALES_STRATEGY_PROMPT).toContain('DIAGNÓSTICO ANTES DEL PRECIO')
    expect(SALES_STRATEGY_PROMPT).toContain('CONTRASTE DE VALOR')
    expect(SALES_STRATEGY_PROMPT).toContain('MANEJO DE OBJECIONES')
    expect(SALES_STRATEGY_PROMPT).toContain('CIERRE ACTIVO')
    expect(SALES_STRATEGY_PROMPT).toContain('Queda prohibido terminar con despedidas pasivas')
  })

  it('es conocimiento puro del puesto: sin dependencias ni lenguaje interno del CRM', () => {
    expect(SALES_STRATEGY_PROMPT).not.toContain('ACCIONES DISPONIBLES')
    expect(SALES_STRATEGY_PROMPT).not.toMatch(/import\s|require\(/)
  })
})

describe('Inyección de la estrategia en los canales conversacionales', () => {
  it('WhatsApp (auto-reply del daemon): estrategia + contexto del cliente en el system prompt', async () => {
    mockedLlm.mockResolvedValueOnce(
      'Un plan básico arranca en 99 USD/mes; ¿cuántos vendedores quieres conectar para recomendarte el ideal?'
    )
    const res = await autoReplyPOST(internalReq({ message: 'Precio', clientId: CLIENT_ESTRATEGIA, source: 'whatsapp' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.reply).toContain('¿cuántos vendedores')

    const sysMsg = mockedLlm.mock.calls[0][1].find((m) => m.role === 'system')!
    // Estrategia consultiva presente en el canal principal
    expect(sysMsg.content).toContain('DIAGNÓSTICO ANTES DEL PRECIO')
    expect(sysMsg.content).toContain('CIERRE ACTIVO')
    // Contratos previos intactos: cliente final, sin herramientas de CRM
    expect(sysMsg.content).toContain('CLIENTES finales')
    expect(sysMsg.content).not.toContain('ACCIONES DISPONIBLES')
    // Orden: la estrategia va ANTES del contexto dinámico del cliente
    const idxEstrategia = sysMsg.content.indexOf('DIAGNÓSTICO ANTES DEL PRECIO')
    const idxCliente = sysMsg.content.indexOf('CLIENTE EN CONVERSACIÓN')
    expect(idxEstrategia).toBeGreaterThan(-1)
    expect(idxCliente).toBeGreaterThan(idxEstrategia)
  })

  it('Instagram (llmReplyOrNotification): estrategia + contexto del negocio y memoria del cliente', async () => {
    mockedLlm.mockClear()
    mockedLlm.mockResolvedValueOnce('Te puedo mostrar opciones según lo que busques; ¿es para uso personal o para tu empresa?')
    const sent: string[] = []
    const res = await llmReplyOrNotification({
      orgId: FIX.orgA.id,
      clientId: CLIENT_ESTRATEGIA,
      channelLabel: 'Instagram',
      incomingText: '¿Qué precios tienen?',
      handoffKeywords: ['hablar con un humano'],
      nichoContext: 'Negocio demo de servicios profesionales.',
      send: async (reply) => {
        sent.push(reply)
      },
    })
    expect(res.replied).toBe(true)
    expect(sent[0]).toContain('personal o para tu empresa')
    const sysMsg = mockedLlm.mock.calls[0][1].find((m) => m.role === 'system')!
    expect(sysMsg.content).toContain('DIAGNÓSTICO ANTES DEL PRECIO')
    expect(sysMsg.content).toContain('Negocio demo de servicios profesionales.')
    expect(sysMsg.content).toContain('Instagram')
  })

  it('canales genéricos preservan el handoff a humano por encima de la estrategia', async () => {
    mockedLlm.mockClear()
    const res = await llmReplyOrNotification({
      orgId: FIX.orgA.id,
      clientId: CLIENT_ESTRATEGIA,
      channelLabel: 'Instagram',
      incomingText: 'Quiero hablar con un humano por favor',
      handoffKeywords: ['hablar con un humano'],
      nichoContext: 'Negocio demo.',
      send: async () => {},
    })
    expect(res.handoff).toBe(true)
    expect(mockedLlm).not.toHaveBeenCalled()
  })
})
