import { describe, expect, it } from 'vitest'
import { buildDealContext, buildDealMessages, parseDealSuggestion } from '@/lib/deal-ai'
import { HttpError } from '@/lib/auth'

/**
 * Tests unitarios de las funciones puras de la IA de cierre (Fase 4):
 * builder de contexto, builder de mensajes del prompt y parser/normalizador
 * de la respuesta del LLM (fail-closed: clamp 0-100, fracciones, strings).
 */

const BASE_OPP = {
  title: 'Implementación CRM',
  amount: 5000,
  currency: 'USD',
  status: 'open',
  probability: null as number | null,
  expectedCloseDate: new Date('2026-03-15T00:00:00Z'),
  source: 'whatsapp',
  notes: JSON.stringify({ text: 'Quiere automatizar WhatsApp', interest: 'Automatización', nextAction: 'Enviar propuesta' }),
  stage: { name: 'Oferta', probability: 0.5 },
  client: { name: 'Cliente Alpha', lastContactAt: new Date('2026-01-10T10:00:00Z'), createdAt: new Date('2026-01-02T10:00:00Z') },
}

describe('buildDealContext', () => {
  it('serializa la oportunidad con probabilidad base de etapa en %', () => {
    const ctx = buildDealContext(BASE_OPP, {
      temperature: 'Caliente',
      quotes: [{ status: 'sent', total: 5000, currency: 'USD', createdAt: new Date('2026-01-12T10:00:00Z') }],
      timeline: [{ type: 'whatsapp', title: 'Mensaje del cliente', createdAt: new Date('2026-01-11T10:00:00Z') }],
    })
    expect(ctx.stageName).toBe('Oferta')
    expect(ctx.stageProbability).toBe(50)
    expect(ctx.currentProbability).toBe(50) // hereda de la etapa si no hay columna
    expect(ctx.clientName).toBe('Cliente Alpha')
    expect(ctx.clientTemperature).toBe('Caliente')
    expect(ctx.interest).toBe('Automatización')
    expect(ctx.currentNextAction).toBe('Enviar propuesta')
    expect(ctx.quotes).toHaveLength(1)
    expect(ctx.quotes[0].status).toBe('sent')
    expect(ctx.recentTimeline[0].type).toBe('whatsapp')
  })

  it('usa 50% por defecto sin etapa ni probabilidad registrada', () => {
    const ctx = buildDealContext({ ...BASE_OPP, stage: null, client: null })
    expect(ctx.stageName).toBeNull()
    expect(ctx.currentProbability).toBe(50)
    expect(ctx.clientName).toBeNull()
    expect(ctx.clientTemperature).toBeNull()
  })

  it('respeta la probabilidad explícita de la columna sobre la de la etapa', () => {
    const ctx = buildDealContext({ ...BASE_OPP, probability: 80 })
    expect(ctx.currentProbability).toBe(80)
  })
})

describe('buildDealMessages', () => {
  it('arma system + user con el contexto clave dentro del user', () => {
    const ctx = buildDealContext(BASE_OPP, { temperature: 'Tibio' })
    const messages = buildDealMessages(ctx)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    // El system prompt exige JSON con las 4 claves y respuesta en español
    expect(messages[0].content).toContain('JSON')
    expect(messages[0].content).toContain('probability')
    expect(messages[0].content).toContain('nextBestAction')
    expect(messages[0].content).toContain('suggestedMessage')
    expect(messages[0].content).toContain('español')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('Implementación CRM')
    expect(messages[1].content).toContain('Cliente Alpha')
    expect(messages[1].content).toContain('Oferta')
    expect(messages[1].content).toContain('USD 5000')
    expect(messages[1].content).toContain('Automatización')
  })
})

describe('parseDealSuggestion', () => {
  it('parsea un JSON válido y recorta los strings', () => {
    const s = parseDealSuggestion(
      JSON.stringify({
        probability: 75,
        nextBestAction: '  Enviar seguimiento hoy  ',
        suggestedMessage: 'Hola, ¿revisaste la propuesta?',
        reasoning: 'Cotización enviada hace 3 días',
      })
    )
    expect(s).toEqual({
      probability: 75,
      nextBestAction: 'Enviar seguimiento hoy',
      suggestedMessage: 'Hola, ¿revisaste la propuesta?',
      reasoning: 'Cotización enviada hace 3 días',
    })
  })

  it('tolera fences de markdown alrededor del JSON', () => {
    const s = parseDealSuggestion(
      '```json\n{"probability": 60, "nextBestAction": "Llamar", "suggestedMessage": "¿Hablamos?", "reasoning": "r"}\n```'
    )
    expect(s.probability).toBe(60)
    expect(s.nextBestAction).toBe('Llamar')
  })

  it('interpola fracciones 0-1 como porcentaje (0.85 → 85)', () => {
    const s = parseDealSuggestion(JSON.stringify({ probability: 0.85, nextBestAction: 'a', suggestedMessage: 'm' }))
    expect(s.probability).toBe(85)
  })

  it('hace clamp a 0-100 (105 → 100, -5 → 0) y redondea decimales', () => {
    expect(parseDealSuggestion(JSON.stringify({ probability: 105, nextBestAction: 'a', suggestedMessage: 'm' })).probability).toBe(100)
    expect(parseDealSuggestion(JSON.stringify({ probability: -5, nextBestAction: 'a', suggestedMessage: 'm' })).probability).toBe(0)
    expect(parseDealSuggestion(JSON.stringify({ probability: 72.6, nextBestAction: 'a', suggestedMessage: 'm' })).probability).toBe(73)
  })

  it('acepta probability numérica como string ("80")', () => {
    const s = parseDealSuggestion('{"probability": "80", "nextBestAction": "a", "suggestedMessage": "m"}')
    expect(s.probability).toBe(80)
  })

  it('rellena razonamiento vacío si la IA no lo envía', () => {
    const s = parseDealSuggestion(JSON.stringify({ probability: 40, nextBestAction: 'a', suggestedMessage: 'm' }))
    expect(s.reasoning).toBe('')
  })

  it('lanza HttpError 502 con texto que no es JSON', () => {
    try {
      parseDealSuggestion('Lo siento, no puedo ayudarte con eso.')
      expect.unreachable('debería haber lanzado')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).status).toBe(502)
    }
  })

  it('lanza HttpError 502 si falta probability', () => {
    try {
      parseDealSuggestion(JSON.stringify({ nextBestAction: 'a', suggestedMessage: 'm' }))
      expect.unreachable('debería haber lanzado')
    } catch (err) {
      expect((err as HttpError).status).toBe(502)
    }
  })

  it('lanza HttpError 502 si no trae acción ni mensaje', () => {
    try {
      parseDealSuggestion(JSON.stringify({ probability: 50, nextBestAction: '  ', suggestedMessage: '' }))
      expect.unreachable('debería haber lanzado')
    } catch (err) {
      expect((err as HttpError).status).toBe(502)
    }
  })
})
