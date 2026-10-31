import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('ALBRA AGENT Bridge (AGENTE GENERAL Integration)', () => {
  const originalFetch = global.fetch

  /**
   * Carga el bridge con env EXPLÍCITO (vi.stubEnv + resetModules): el módulo lee
   * ALBRA_AGENT_ENABLED al importarse, y el .env del sandbox ahora trae
   * ALBRA_AGENT_ENABLED=false (desconexión explícita, política 2026-10-31).
   * Cada test define su propia config en vez de depender del entorno global.
   */
  async function loadBridgeWith(env: Record<string, string>) {
    vi.resetModules()
    vi.unstubAllEnvs()
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    return import('@/lib/albra-agent-bridge')
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllEnvs()
  })

  it('isAgentBridgeEnabled() devuelve true con ALBRA_AGENT_ENABLED=true', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true' })
    expect(bridge.isAgentBridgeEnabled()).toBe(true)
  })

  it('isAgentBridgeEnabled() devuelve false con ALBRA_AGENT_ENABLED=false (desconexión explícita sin borrar código)', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'false' })
    expect(bridge.isAgentBridgeEnabled()).toBe(false)
  })

  it('checkAgentHealth() reporta online: true cuando /api/v1/health responde 200', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true' })
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', version: '1.0.0' }),
    })

    const health = await bridge.checkAgentHealth(true)

    expect(health.online).toBe(true)
    expect(health.status).toBe('healthy')
    expect(health.error).toBeUndefined()
  })

  it('checkAgentHealth() reporta online: false cuando el servicio no responde', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true' })
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:9000'))

    const health = await bridge.checkAgentHealth(true)

    expect(health.online).toBe(false)
    expect(health.error).toContain('ECONNREFUSED')
  })

  it('executeAgentQuery() procesa respuesta exitosa con tool_calls', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true' })
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

    const result = await bridge.executeAgentQuery({
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
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true' })
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

    const result = await bridge.executeAgentQuery({
      input: 'Agenda una cita para corte',
    })

    expect(result.ok).toBe(true)
    expect(result.source).toBe('albra-agent')
    expect(result.action).toBe('schedule_reservation')
    expect(result.params?.title).toBe('Cita corte')
  })

  it('executeAgentQuery() devuelve fallback cuando el agente responde 500', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true' })
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

    const result = await bridge.executeAgentQuery({
      input: 'Hola',
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe('local-fallback')
    expect(result.error).toContain('HTTP 500')
  })

  it('executeAgentQuery() va directo a fallback sin fetch cuando el puente está deshabilitado', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'false' })
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof global.fetch

    const result = await bridge.executeAgentQuery({ input: 'Hola' })

    expect(result.ok).toBe(false)
    expect(result.source).toBe('local-fallback')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
