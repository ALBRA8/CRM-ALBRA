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
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true', ALBRA_AGENT_API_KEY: 'test-key' })
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
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true', ALBRA_AGENT_API_KEY: 'test-key' })
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
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true', ALBRA_AGENT_API_KEY: 'test-key' })
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
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'false', ALBRA_AGENT_API_KEY: 'test-key' })
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof global.fetch

    const result = await bridge.executeAgentQuery({ input: 'Hola' })

    expect(result.ok).toBe(false)
    expect(result.source).toBe('local-fallback')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ---------- P-01: fail-closed sin credencial de servicio ----------

  it('P-01: sin ALBRA_AGENT_API_KEY la ejecución es fail-closed y NUNCA llama al agente', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true', ALBRA_AGENT_URL: 'http://localhost:9000' })
    expect(bridge.agentCredentialConfigured()).toBe(false)
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof global.fetch

    const result = await bridge.executeAgentQuery({ input: 'Hola', sessionId: 's1', orgId: 'org-a' })

    expect(result.ok).toBe(false)
    expect(result.source).toBe('local-fallback')
    expect(result.error).toContain('ALBRA_AGENT_API_KEY')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('P-01: el fallback al-bradev-token fue eliminado (ya no hay credencial por defecto)', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true' })
    expect(bridge.agentCredentialConfigured()).toBe(false)
  })

  // ---------- P-02: propagación de tenant ----------

  it('P-02: el body lleva organization_id, la sesión va con namespace de org y la cabecera X-Albra-Org', async () => {
    const bridge = await loadBridgeWith({ ALBRA_AGENT_ENABLED: 'true', ALBRA_AGENT_API_KEY: 'test-key' })
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'healthy' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ execution_id: 'e1', content: 'ok' }),
      })
    global.fetch = fetchSpy as unknown as typeof global.fetch

    const result = await bridge.executeAgentQuery({ input: 'Hola', sessionId: 'client-1', orgId: 'org-a' })
    expect(result.ok).toBe(true)

    const [, init] = fetchSpy.mock.calls[1] as [string, { headers: Record<string, string>; body: string }]
    const body = JSON.parse(init.body)
    expect(body.organization_id).toBe('org-a')
    expect(body.session_id).toBe('org-a:client-1') // namespace de org (defensa en profundidad)
    expect(init.headers['X-Albra-Org']).toBe('org-a')
    expect(init.headers['Authorization']).toBe('Bearer test-key')
  })

  it('P-01: con ALBRA_AGENT_SIGNING_KEY el request se firma (X-Albra-Signature HMAC del ts+body)', async () => {
    const { createHmac } = await import('crypto')
    const bridge = await loadBridgeWith({
      ALBRA_AGENT_ENABLED: 'true',
      ALBRA_AGENT_API_KEY: 'test-key',
      ALBRA_AGENT_SIGNING_KEY: 'signing-secret',
    })
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'healthy' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: 'ok' }) })
    global.fetch = fetchSpy as unknown as typeof global.fetch

    await bridge.executeAgentQuery({ input: 'Hola', orgId: 'org-a' })

    const [, init] = fetchSpy.mock.calls[1] as [string, { headers: Record<string, string>; body: string }]
    const ts = init.headers['X-Albra-Timestamp']
    expect(ts).toMatch(/^\d+$/)
    const expected = createHmac('sha256', 'signing-secret').update(`${ts}.${init.body}`).digest('hex')
    expect(init.headers['X-Albra-Signature']).toBe(expected)
  })
})
