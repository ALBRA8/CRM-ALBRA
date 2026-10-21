import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  checkAgentHealth,
  executeAgentQuery,
  isAgentBridgeEnabled,
} from '@/lib/albra-agent-bridge'

describe('ALBRA AGENT Bridge (AGENTE GENERAL Integration)', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('isAgentBridgeEnabled() devuelve true por defecto', () => {
    expect(isAgentBridgeEnabled()).toBe(true)
  })

  it('checkAgentHealth() reporta online: true cuando /api/v1/health responde 200', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', version: '1.0.0' }),
    })

    const health = await checkAgentHealth(true)

    expect(health.online).toBe(true)
    expect(health.status).toBe('healthy')
    expect(health.error).toBeUndefined()
  })

  it('checkAgentHealth() reporta online: false cuando el servicio no responde', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:9000'))

    const health = await checkAgentHealth(true)

    expect(health.online).toBe(false)
    expect(health.error).toContain('ECONNREFUSED')
  })

  it('executeAgentQuery() procesa respuesta exitosa con tool_calls', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          execution_id: 'exec-123',
          content: 'Voy a crear el cliente Juan',
          tool_calls: [
            {
              name: 'create_client',
              parameters: { name: 'Juan Perez', phone: '+573001234567' },
            },
          ],
        }),
      })

    const result = await executeAgentQuery({
      input: 'Registra a Juan Perez con celular +573001234567',
      sessionId: 'session-client-1',
    })

    expect(result.ok).toBe(true)
    expect(result.source).toBe('albra-agent')
    expect(result.action).toBe('create_client')
    expect(result.params?.name).toBe('Juan Perez')
    expect(result.executionId).toBe('exec-123')
  })

  it('executeAgentQuery() extrae acciones JSON dentro de content si no hay tool_calls', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          execution_id: 'exec-456',
          content: '{"action": "schedule_reservation", "params": {"title": "Cita corte", "startsAt": "2026-10-25T15:00:00Z"}}',
        }),
      })

    const result = await executeAgentQuery({
      input: 'Agenda una cita para corte',
    })

    expect(result.ok).toBe(true)
    expect(result.source).toBe('albra-agent')
    expect(result.action).toBe('schedule_reservation')
    expect(result.params?.title).toBe('Cita corte')
  })

  it('executeAgentQuery() devuelve fallback cuando el agente responde 500', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Error',
      })

    const result = await executeAgentQuery({
      input: 'Hola',
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe('local-fallback')
    expect(result.error).toContain('HTTP 500')
  })
})
