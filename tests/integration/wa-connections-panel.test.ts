import { describe, expect, it, vi, afterEach } from 'vitest'
import { GET as panelGet } from '@/app/api/whatsapp/connections-panel/route'
import { db } from '@/lib/db'
import type { ConnectionsPanelView, ConnectionCard } from '@/lib/wa-connections-view'
import { jsonBody, req, tokenA, tokenB } from '../helpers'

/**
 * F2 — GET /api/whatsapp/connections-panel (vista agregada del panel).
 *
 * Se testea el CONTRATO que la UI consume:
 *  - autenticación obligatoria (orgId del JWT, jamás del cliente);
 *  - aislamiento multi-tenant: cada org solo ve SUS conexiones;
 *  - el veredicto de sesión Baileys se calcula contra el daemon REAL
 *    (stub en pruebas, regla 9: sin red) y el fallo es fail-closed (UNKNOWN);
 *  - el plan y su límite llegan listos para la UI.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Cuerpo tipado del panel (la respuesta de la ruta es exactamente esta vista). */
async function panelBody(res: Response): Promise<ConnectionsPanelView> {
  return (await res.json()) as ConnectionsPanelView
}
function cardsOf(body: ConnectionsPanelView): ConnectionCard[] {
  return body.cards
}

/** Stub del daemon multi-org: sessions[] con la org pedida (o sin ella). */
function stubDaemonMultiOrg(orgId: string | null, session?: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const sessions = orgId
    ? [{ orgId, status: 'connected', phone: '+52 1 55 0000 0000', lastUpdate: '2026-11-20T10:00:00.000Z', lastError: null, ...(session ?? {}) }]
    : []
  return vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input).endsWith('/status')).toBe(true)
    return new Response(JSON.stringify({ status: sessions.length ? 'connected' : 'disconnected', orgLinked: sessions.length > 0, sessions }), { status: 200 })
  })
}

// (UNIFICACIÓN 2026-11-21) La única fuente es ChannelConnection (meta_cloud).
async function cleanupConnections(orgId: string) {
  await db.channelConnection.deleteMany({ where: { organizationId: orgId, provider: 'meta_cloud' } })
  await db.channelConnectionEvent.deleteMany({ where: { organizationId: orgId } })
}

describe('GET /api/whatsapp/connections-panel', () => {
  it('exige autenticación (401 sin JWT)', async () => {
    const res = await panelGet(req('/api/whatsapp/connections-panel'))
    expect(res.status).toBe(401)
  })

  it('refleja el veredicto REAL del daemon para la organización del JWT', async () => {
    await cleanupConnections('org-a')
    const fetchMock = stubDaemonMultiOrg('org-a')
    vi.stubGlobal('fetch', fetchMock)

    const res = await panelGet(req('/api/whatsapp/connections-panel', { token: tokenA() }))
    expect(res.status).toBe(200)
    const body = await panelBody(res)

    const baileys = cardsOf(body).find((c) => c.kind === 'baileys')
    expect(baileys).toBeDefined()
    if (!baileys) return
    expect(baileys.status).toBe('connected')
    expect(baileys.subtitle).toBe('+52 1 55 0000 0000')
    expect(body.baileys.available).toBe(true)
    expect(body.baileys.phone).toBe('+52 1 55 0000 0000')
    // owner de org-a → acciones sensibles visibles
    expect(baileys.canDisconnect).toBe(true)
    expect(body.plan).toMatchObject({ maxConnections: expect.any(Number), activeConnections: expect.any(Number) })
  })

  it('UNLINKED: el daemon verificó que MI org no tiene sesión → desconectado + puede conectar', async () => {
    await cleanupConnections('org-b')
    vi.stubGlobal('fetch', stubDaemonMultiOrg('org-a')) // solo la sesión de la OTRA org

    const res = await panelGet(req('/api/whatsapp/connections-panel', { token: tokenB() }))
    const body = await panelBody(res)
    expect(body.baileys.status).toBe('disconnected')
    expect(body.baileys.available).toBe(true)
    expect(body.baileys.phone).toBeNull() // jamás se fuga el teléfono de la otra org
  })

  it('aislamiento: las conexiones Cloud de OTRA organización jamás aparecen', async () => {
    await cleanupConnections('org-a')
    await cleanupConnections('org-b')
    const { createConnection } = await import('@/lib/wa-connections')
    const created = await createConnection({
      orgId: 'org-a',
      phoneNumberId: '555000111',
      accessToken: 'EAAG-token-panel-test-0123456789', // scan-secrets:allow
      verifyAgainstGraph: false,
      source: 'manual',
    })
    expect(created.ok).toBe(true)

    vi.stubGlobal('fetch', stubDaemonMultiOrg(null))
    // member de org B consulta su panel: cero rastros de la conexión de org A
    const resB = await panelGet(req('/api/whatsapp/connections-panel', { token: tokenB() }))
    const bodyB = await panelBody(resB)
    const cloudB = cardsOf(bodyB).filter((c) => c.kind === 'meta_cloud')
    expect(cloudB).toHaveLength(0)
    expect(JSON.stringify(bodyB)).not.toContain('555000111')
    expect(JSON.stringify(bodyB)).not.toContain('org-a')

    // y org A SÍ ve la suya
    const resA = await panelGet(req('/api/whatsapp/connections-panel', { token: tokenA() }))
    const bodyA = await panelBody(resA)
    const cloudA = cardsOf(bodyA).filter((c) => c.kind === 'meta_cloud')
    expect(cloudA).toHaveLength(1)
    expect(cloudA[0].subtitle).toContain('555000111')
    // el material sensible jamás sale por el panel
    expect(JSON.stringify(bodyA)).not.toContain('accessToken')
  })

  it('daemon caído: fail-closed — "Sin verificar", available false, sin estado fingido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED (daemon apagado)')
    }))
    const res = await panelGet(req('/api/whatsapp/connections-panel', { token: tokenA() }))
    expect(res.status).toBe(200)
    const body = await panelBody(res)
    expect(body.baileys.available).toBe(false)
    expect(body.baileys.status).toBe('unknown')
    const baileys = cardsOf(body).find((c) => c.kind === 'baileys')
    if (!baileys) return
    expect(baileys.statusLabel).toMatch(/Sin verificar/)
    expect(baileys.detail).toMatch(/No se pudo verificar/)
  })

  it('respuesta ambigua del daemon (no JSON): también UNKNOWN, nunca inventa estado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('HTML de error', { status: 200 })))
    const res = await panelGet(req('/api/whatsapp/connections-panel', { token: tokenA() }))
    const body = await panelBody(res)
    expect(body.baileys.status).toBe('unknown')
    expect(body.baileys.available).toBe(false)
  })

  it('el consumo del plan llega con el límite por plan de la organización', async () => {
    await cleanupConnections('org-a')
    const org = await db.organization.findUnique({ where: { id: 'org-a' }, select: { plan: true } })
    vi.stubGlobal('fetch', stubDaemonMultiOrg(null))

    const res = await panelGet(req('/api/whatsapp/connections-panel', { token: tokenA() }))
    const body = await panelBody(res)
    expect(body.plan.plan).toBe(org?.plan ?? 'pilot')
    expect(body.plan.activeConnections).toBeGreaterThanOrEqual(0)
    expect(body.plan.maxConnections).toBeGreaterThanOrEqual(1)
    if (body.plan.activeConnections >= body.plan.maxConnections) {
      expect(body.canAddCloud).toBe(false)
      expect(body.addBlockReason).toMatch(/plan/i)
    } else {
      expect(body.canAddCloud).toBe(true)
      expect(body.addBlockReason).toBeNull()
    }
  })
})
