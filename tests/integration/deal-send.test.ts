import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest'
import { POST as aiSuggestPOST } from '@/app/api/opportunities/[id]/ai-suggest/route'
import { POST as inboxSendPOST } from '@/app/api/inbox/send/route'
import { db } from '@/lib/db'
import { llmChat } from '@/lib/ai'
import { normalizeWaPhone } from '@/lib/inbox'
import { FIX, jsonBody, req, routeParams, tokenA, tokenB } from '../helpers'

/**
 * Envío directo del mensaje sugerido por la IA de cierre (Task 19-b).
 *
 * Escenario central: cliente con `phone` pero SIN conversación activa ni
 * timeline de canales — el caso que dejaba el diálogo sin ningún botón de
 * envío antes de esta tarea.
 *
 *  - normalizeWaPhone: normalización al formato del daemon (E.164 sin '+').
 *  - POST /api/opportunities/:id/ai-suggest → channels incluye el canal directo
 *    "wa-new:<teléfono>" (LLM mockeado, mismo patrón que deal-ai.test.ts).
 *  - POST /api/inbox/send con key "wa-new:" → daemon mockeado (vi.stubGlobal de
 *    fetch global; ningún test habla con un daemon real) + find-or-create de la
 *    WhatsAppConversation (unique organizationId+contactPhone) con nombre del
 *    cliente y lastMessage saliente. Fallo del daemon → 400 y NADA creado.
 */

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>()
  return { ...actual, llmChat: vi.fn() }
})

const mockedLlm = vi.mocked(llmChat)

// Teléfono guardado con formato "humano" (la normalización lo convierte).
const CLIENT_PHONE_RAW = '+57 315 666 5577'
const CLIENT_PHONE = '573156665577'
const CLIENT_ID = 'client-a3-phone'
const OPP_ID = 'opp-send-a'
const SEND_TEXT = 'Hola Ana, ¿seguimos con la propuesta de implementación?'

const VALID_LLM_JSON = JSON.stringify({
  probability: 55,
  nextBestAction: 'Enviar el seguimiento hoy mismo',
  suggestedMessage: SEND_TEXT,
  reasoning: 'Cliente con teléfono válido y sin conversación previa.',
})

const daemonUrl = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'

beforeAll(async () => {
  // Cliente CON teléfono y SIN conversación WhatsApp ni timeline TG/IG.
  await db.client.create({
    data: {
      id: CLIENT_ID,
      organizationId: FIX.orgA.id,
      name: 'Cliente Solo Teléfono',
      phone: CLIENT_PHONE_RAW,
      status: 'active',
    },
  })
  const stage = await db.pipelineStage.create({
    data: { id: 'stage-send-a', organizationId: FIX.orgA.id, name: 'Seguimiento', order: 9, probability: 0.3 },
  })
  await db.opportunity.create({
    data: {
      id: OPP_ID,
      organizationId: FIX.orgA.id,
      title: 'Oportunidad Solo Teléfono',
      clientId: CLIENT_ID,
      stageId: stage.id,
      amount: 2500,
      currency: 'USD',
    },
  })
  if (!process.env.INTERNAL_API_SECRET) {
    // El setup carga el .env real; fallback defensivo para entornos sin él.
    process.env.INTERNAL_API_SECRET = 'test-internal-secret'
  }
})

describe('normalizeWaPhone (formato del daemon: E.164 sin +)', () => {
  it('normaliza +, espacios y guiones a solo dígitos', () => {
    expect(normalizeWaPhone('+57 315 666 5577')).toBe('573156665577')
    expect(normalizeWaPhone('(57) 300-111-0000')).toBe('573001110000')
    expect(normalizeWaPhone('573001110000')).toBe('573001110000')
  })

  it('fail-closed: null ante vacío, texto sin dígitos o teléfonos demasiado cortos', () => {
    expect(normalizeWaPhone(null)).toBeNull()
    expect(normalizeWaPhone(undefined)).toBeNull()
    expect(normalizeWaPhone('')).toBeNull()
    expect(normalizeWaPhone('no hay teléfono')).toBeNull()
    expect(normalizeWaPhone('123')).toBeNull()
  })
})

describe('POST /api/opportunities/:id/ai-suggest — canal directo wa-new', () => {
  it('cliente con phone y sin conversación → channels ofrece "wa-new:<teléfono>"', async () => {
    mockedLlm.mockResolvedValueOnce(VALID_LLM_JSON)
    const res = await aiSuggestPOST(req(`/api/opportunities/${OPP_ID}`, { method: 'POST', token: tokenA() }), routeParams(OPP_ID))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const channels = body.channels as Array<{ key: string; channel: string; channelLabel: string; contactHandle: string }>
    // Solo WhatsApp directo: sin conversación ni timeline TG/IG no hay más canales.
    expect(channels).toHaveLength(1)
    expect(channels[0]).toMatchObject({
      key: `wa-new:${CLIENT_PHONE}`,
      channel: 'whatsapp',
      channelLabel: 'WhatsApp',
      contactHandle: CLIENT_PHONE, // normalizado (sin '+' ni espacios)
    })
    // Nunca ofrece una key de conversación inexistente.
    expect(channels.some((c) => c.key.startsWith('wa:'))).toBe(false)
  })
})

describe('POST /api/inbox/send — key "wa-new:<teléfono>"', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubDaemon(handler: () => Response): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => handler())
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('daemon OK → 200, payload { to, text } y conversación creada con nombre y lastMessage saliente', async () => {
    const fetchMock = stubDaemon(() => new Response(JSON.stringify({ success: true, messageId: 'MSG-TEST-1' }), { status: 200 }))
    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: `wa-new:${CLIENT_PHONE}`, contactHandle: CLIENT_PHONE, clientId: CLIENT_ID, text: SEND_TEXT },
    }))
    expect(res.status).toBe(200)
    expect(await jsonBody(res)).toMatchObject({ success: true, sent: true })

    // Mismo camino daemon que wa:<convId>: POST /send con { to, text } + Bearer secreto.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe(`${daemonUrl}/send`)
    expect(init.headers.Authorization).toMatch(/^Bearer /)
    expect(JSON.parse(init.body)).toEqual({ to: CLIENT_PHONE, text: SEND_TEXT })

    // find-or-create: conversación creada con el nombre del cliente y trazabilidad
    // de último mensaje saliente (igual que deja el daemon en los entrantes).
    const conv = await db.whatsAppConversation.findUnique({
      where: { organizationId_contactPhone: { organizationId: FIX.orgA.id, contactPhone: CLIENT_PHONE } },
    })
    expect(conv).not.toBeNull()
    expect(conv?.contactName).toBe('Cliente Solo Teléfono')
    expect(conv?.clientId).toBe(CLIENT_ID)
    expect(conv?.lastMessage).toBe(SEND_TEXT)
    expect(conv?.lastMessageFrom).toBe('out')
    expect(conv?.lastMessageAt).not.toBeNull()
  })

  it('segundo envío al mismo teléfono reutiliza la conversación (find, no duplica)', async () => {
    stubDaemon(() => new Response(JSON.stringify({ success: true }), { status: 200 }))
    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: `wa-new:${CLIENT_PHONE}`, contactHandle: CLIENT_PHONE, clientId: CLIENT_ID, text: 'Segundo mensaje' },
    }))
    expect(res.status).toBe(200)
    const convs = await db.whatsAppConversation.findMany({ where: { organizationId: FIX.orgA.id, contactPhone: CLIENT_PHONE } })
    expect(convs).toHaveLength(1)
  })

  it('daemon caído → 400 descriptivo y SIN crear conversación', async () => {
    stubDaemon(() => new Response(JSON.stringify({ error: 'WhatsApp no conectado' }), { status: 400 }))
    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: 'wa-new:573109998877', contactHandle: '573109998877', text: 'hola' },
    }))
    expect(res.status).toBe(400)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/WhatsApp no conectado/)
    const conv = await db.whatsAppConversation.findUnique({
      where: { organizationId_contactPhone: { organizationId: FIX.orgA.id, contactPhone: '573109998877' } },
    })
    expect(conv).toBeNull()
  })

  it('teléfono inválido en la key → 400 y nunca llama al daemon', async () => {
    const fetchMock = stubDaemon(() => new Response('{}', { status: 200 }))
    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: 'wa-new:no-hay-teléfono', contactHandle: '', text: 'hola' },
    }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('multi-tenant: org-b envía por wa-new y la conversación se crea en SU org (no en org-a)', async () => {
    stubDaemon(() => new Response(JSON.stringify({ success: true }), { status: 200 }))
    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenB(),
      body: { key: 'wa-new:573201234567', contactHandle: '573201234567', clientId: null, text: 'hola desde org-b' },
    }))
    expect(res.status).toBe(200)
    const inA = await db.whatsAppConversation.findUnique({
      where: { organizationId_contactPhone: { organizationId: FIX.orgA.id, contactPhone: '573201234567' } },
    })
    const inB = await db.whatsAppConversation.findUnique({
      where: { organizationId_contactPhone: { organizationId: FIX.orgB.id, contactPhone: '573201234567' } },
    })
    expect(inA).toBeNull()
    expect(inB).not.toBeNull()
    // Sin clientId el nombre cae al teléfono (igual que el daemon).
    expect(inB?.contactName).toBe('573201234567')
  })
})
