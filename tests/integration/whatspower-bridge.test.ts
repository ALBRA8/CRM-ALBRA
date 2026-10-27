import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'crypto'
import {
  forwardInboundToWhatspower,
  notifyWhatspowerStageChange,
  signWhatspowerPayload,
  isWhatspowerEnabled,
} from '@/lib/whatspower-bridge'

/**
 * Bridge CRM→WHATSPOWER (Nivel 2).
 *
 * Contrato WHATSPOWER (/api/inbound):
 *   - X-Signature-SHA256: HMAC-SHA256 HEX del body crudo con el secret compartido
 *   - X-Timestamp: epoch ms (ventana anti-replay 300s del receptor)
 *   - body: { eventId, orgId, contact: { phone, name? }, message: { text } }
 * Contrato WHATSPOWER (/api/crm/stage-change):
 *   - body: { clientId?, clientPhone?, clientName?, opportunityId, fromStage, toStage, dealValue? }
 *
 * Reglas de robustez: sin env = no-op puro; fallo de red = controlado (nunca lanza).
 */

const SECRET = 'e2e-whatspower-secret-2026-32chars!'
const originalFetch = global.fetch
const originalEnv = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
}

function enableBridge(url = 'http://localhost:3003') {
  process.env.WHATSPOWER_ENABLED = 'true'
  process.env.WHATSPOWER_WEBHOOK_SECRET = SECRET
  process.env.WHATSPOWER_INBOUND_URL = `${url}/api/inbound`
  process.env.WHATSPOWER_STAGE_URL = `${url}/api/crm/stage-change`
}

describe('whatspower-bridge: configuración', () => {
  afterEach(restoreEnv)

  it('sin WHATSPOWER_ENABLED=true es no-op (disabled)', async () => {
    delete process.env.WHATSPOWER_ENABLED
    expect(isWhatspowerEnabled()).toBe(false)
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any
    const res = await forwardInboundToWhatspower({ orgId: 'org-a', phone: '573001112233', text: 'hola' })
    expect(res.sent).toBe(false)
    expect(res.skipped).toBe('disabled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enabled sin secret → skipped no_secret (fail-closed, sin envío)', async () => {
    enableBridge()
    delete process.env.WHATSPOWER_WEBHOOK_SECRET
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any
    const res = await forwardInboundToWhatspower({ orgId: 'org-a', phone: '573001112233', text: 'hola' })
    expect(res.sent).toBe(false)
    expect(res.skipped).toBe('no_secret')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('whatspower-bridge: contrato inbound (HMAC)', () => {
  beforeEach(() => {
    enableBridge()
  })
  afterEach(restoreEnv)

  it('envía body contractual con firma HMAC-SHA256 y timestamp verificables', async () => {
    let captured: { raw: string; sig?: string; ts?: string } | null = null
    global.fetch = vi.fn().mockImplementation(async (_url, init: any) => {
      captured = { raw: init.body, sig: init.headers['X-Signature-SHA256'], ts: init.headers['X-Timestamp'] }
      return { ok: true, status: 200, text: async () => '{"handled":true}' }
    }) as any

    const res = await forwardInboundToWhatspower({
      orgId: 'org-a',
      phone: '573001112233',
      name: 'E2E WhatsPower CRM 2026',
      text: 'Quiero información del plan',
      messageId: 'wamid.E2E-WHATSPOWER-CRM-2026-1',
    })

    expect(res.sent).toBe(true)
    const body = JSON.parse(captured!.raw)
    expect(body.eventId).toBe('wamid.E2E-WHATSPOWER-CRM-2026-1')
    expect(body.orgId).toBe('org-a')
    expect(body.contact.phone).toBe('573001112233')
    expect(body.contact.name).toBe('E2E WhatsPower CRM 2026')
    expect(body.message.text).toBe('Quiero información del plan')

    // Firma HMAC verificable con el mismo algoritmo del receptor (WhatsPower verifyHmac)
    const expected = createHmac('sha256', SECRET).update(captured!.raw, 'utf8').digest('hex')
    expect(captured!.sig).toBe(expected)
    expect(signWhatspowerPayload(captured!.raw, SECRET)).toBe(expected)

    // Timestamp anti-replay dentro de la ventana de 300s
    const ts = Number(captured!.ts)
    expect(Number.isFinite(ts)).toBe(true)
    expect(Math.abs(Date.now() - ts)).toBeLessThan(300_000)
  })

  it('sin messageId genera eventId estable no-vacío', async () => {
    let raw = ''
    global.fetch = vi.fn().mockImplementation(async (_url, init: any) => {
      raw = init.body
      return { ok: true, status: 200, text: async () => '{}' }
    }) as any
    const res = await forwardInboundToWhatspower({ orgId: 'org-a', phone: '1', text: 'x' })
    expect(res.sent).toBe(true)
    expect(JSON.parse(raw).eventId).toMatch(/^crm_/)
  })

  it('fallo de red (WhatsPower caído) se controla sin lanzar', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:3003')) as any
    const res = await forwardInboundToWhatspower({ orgId: 'org-a', phone: '573001112233', text: 'hola' })
    expect(res.sent).toBe(false)
    expect(res.skipped).toBe('inbound_error')
    expect(res.error).toMatch(/ECONNREFUSED/)
  })

  it('respuesta HTTP 401 (firma rechazada) se controla con status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Firma HMAC inválida o ausente"}',
    }) as any
    const res = await forwardInboundToWhatspower({ orgId: 'org-a', phone: '1', text: 'x' })
    expect(res.sent).toBe(false)
    expect(res.skipped).toBe('inbound_error')
    expect(res.status).toBe(401)
  })
})

describe('whatspower-bridge: contrato stage-change', () => {
  afterEach(restoreEnv)

  it('enabled envía payload de cambio de etapa al endpoint configurado', async () => {
    enableBridge()
    let captured: { url: string; raw: string } | null = null
    global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
      captured = { url: String(url), raw: init.body }
      return { ok: true, status: 200, text: async () => '{"triggered":true}' }
    }) as any

    const res = await notifyWhatspowerStageChange({
      orgId: 'org-a',
      clientId: 'client-a1',
      clientPhone: '573001112233',
      clientName: 'Cliente E2E',
      opportunityId: 'opp-e2e-1',
      fromStage: 'PROPUESTA_ENVIADA',
      toStage: 'GANADO',
      dealValue: 1500,
    })

    expect(res.sent).toBe(true)
    expect(captured!.url).toBe('http://localhost:3003/api/crm/stage-change')
    const body = JSON.parse(captured!.raw)
    expect(body).toEqual({
      clientId: 'client-a1',
      clientPhone: '573001112233',
      clientName: 'Cliente E2E',
      opportunityId: 'opp-e2e-1',
      fromStage: 'PROPUESTA_ENVIADA',
      toStage: 'GANADO',
      dealValue: 1500,
    })
  })

  it('disabled por defecto: stage-change no sale de la org', async () => {
    delete process.env.WHATSPOWER_ENABLED
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any
    const res = await notifyWhatspowerStageChange({
      orgId: 'org-a',
      opportunityId: 'opp-1',
      fromStage: 'A',
      toStage: 'B',
    })
    expect(res.sent).toBe(false)
    expect(res.skipped).toBe('disabled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fallo de red controlado (sin lanzar) — el pipeline del CRM nunca depende de WhatsPower', async () => {
    enableBridge()
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as any
    const res = await notifyWhatspowerStageChange({
      orgId: 'org-a',
      opportunityId: 'opp-1',
      fromStage: 'A',
      toStage: 'B',
    })
    expect(res.sent).toBe(false)
    expect(res.skipped).toBe('inbound_error')
  })
})
