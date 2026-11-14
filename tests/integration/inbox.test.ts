import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest'
import { GET as inboxGET } from '@/app/api/inbox/route'
import { POST as inboxSendPOST } from '@/app/api/inbox/send/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'

/**
 * Bandeja omnicanal (Fase 4) — integración contra BD efímera.
 *
 * Semilla: WhatsApp (tabla propia) + Telegram e Instagram (timeline) para
 * org-a; datos propios para org-b. Escenarios:
 *  - Lista unificada con los 3 canales, ordenada por actividad.
 *  - Aislamiento multi-tenant estricto (org-b no ve nada de org-a).
 *  - Hilo por key + marca de leída (WA unreadCount=0, TG/IG metadata.readAt).
 *  - Key inválida → 400; sin sesión → 401.
 *  - Envío: validaciones (key/texto) y degradación elegante de canal sin
 *    configurar (400 descriptivo, nunca 500).
 */

let waConvId = 'conv-wa-a'
const tgClientId = 'client-a1'
const igClientId = 'client-a2'
const waPhone = '+573001110000'

beforeAll(async () => {
  // WhatsApp org-a: conversación con 1 entrante sin leer + 1 saliente
  const conv = await db.whatsAppConversation.create({
    data: {
      id: waConvId,
      organizationId: FIX.orgA.id,
      clientId: tgClientId,
      contactPhone: waPhone,
      contactName: 'WA Contacto',
      lastMessage: '¿Tienen disponibilidad?',
      lastMessageAt: new Date('2026-01-03T10:00:00Z'),
      lastMessageFrom: 'in',
      unreadCount: 2,
      isAutoReply: true,
    },
  })
  waConvId = conv.id
  await db.whatsAppMessage.createMany({
    data: [
      { organizationId: FIX.orgA.id, conversationId: conv.id, direction: 'inbound', fromNumber: waPhone, toNumber: 'biz', senderType: 'contact', text: 'Hola', createdAt: new Date('2026-01-03T09:59:00Z') },
      { organizationId: FIX.orgA.id, conversationId: conv.id, direction: 'outbound', fromNumber: 'biz', toNumber: waPhone, senderType: 'user', text: '¡Hola! Bienvenido', createdAt: new Date('2026-01-03T10:00:30Z') },
    ],
  })

  // Telegram org-a (timeline): 2 entrantes sin leer + 1 saliente del agente
  await db.timelineEvent.createMany({
    data: [
      { organizationId: FIX.orgA.id, clientId: tgClientId, type: 'telegram', title: 'in 1', description: 'Primera pregunta', metadata: JSON.stringify({ chatId: '555001', direction: 'in' }), source: 'integration', createdAt: new Date('2026-01-04T10:00:00Z') },
      { organizationId: FIX.orgA.id, clientId: tgClientId, type: 'telegram', title: 'out 1', description: 'Respuesta del agente', metadata: JSON.stringify({ chatId: '555001', direction: 'out' }), source: 'agent', createdAt: new Date('2026-01-04T10:01:00Z') },
      { organizationId: FIX.orgA.id, clientId: tgClientId, type: 'telegram', title: 'in 2', description: 'Segunda pregunta', metadata: JSON.stringify({ chatId: '555001', direction: 'in' }), source: 'integration', createdAt: new Date('2026-01-04T10:02:00Z') },
    ],
  })

  // Instagram org-a: 1 leído (con readAt) + 1 sin leer
  await db.timelineEvent.createMany({
    data: [
      { organizationId: FIX.orgA.id, clientId: igClientId, type: 'instagram', title: 'ig in 1', description: 'DM leído', metadata: JSON.stringify({ senderId: 'ig-user-1', direction: 'in', readAt: '2026-01-05T10:00:00Z' }), source: 'integration', createdAt: new Date('2026-01-05T09:00:00Z') },
      { organizationId: FIX.orgA.id, clientId: igClientId, type: 'instagram', title: 'ig in 2', description: 'DM nuevo', metadata: JSON.stringify({ senderId: 'ig-user-1', direction: 'in' }), source: 'integration', createdAt: new Date('2026-01-05T10:05:00Z') },
    ],
  })

  // org-b: su propia conversación TG (para probar aislamiento)
  await db.timelineEvent.createMany({
    data: [
      { organizationId: FIX.orgB.id, clientId: FIX.clientB1.id, type: 'telegram', title: 'tg org-b', description: 'Solo org-b', metadata: JSON.stringify({ chatId: '777002', direction: 'in' }), source: 'integration', createdAt: new Date('2026-01-06T10:00:00Z') },
    ],
  })
})

describe('GET /api/inbox — listado unificado', () => {
  it('sin sesión → 401', async () => {
    const res = await inboxGET(req('/inbox'))
    expect(res.status).toBe(401)
  })

  it('mezcla los 3 canales de org-a, ordenados por actividad reciente', async () => {
    const res = await inboxGET(req('/inbox', { token: tokenA() }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const convs = body.conversations as Array<{ key: string; channel: string; unreadCount: number; contactHandle?: string }>
    const channels = new Set(convs.map((c) => c.channel))
    expect(channels).toEqual(new Set(['whatsapp', 'telegram', 'instagram']))

    const keys = convs.map((c) => c.key)
    expect(keys).toContain(`wa:${waConvId}`)
    expect(keys).toContain(`tg:${tgClientId}`)
    expect(keys).toContain(`ig:${igClientId}`)

    // Orden descendente por lastMessageAt (ig 10:05 → tg 10:02 → wa 10:00)
    const idxIg = keys.indexOf(`ig:${igClientId}`)
    const idxTg = keys.indexOf(`tg:${tgClientId}`)
    const idxWa = keys.indexOf(`wa:${waConvId}`)
    expect(idxIg).toBeLessThan(idxTg)
    expect(idxTg).toBeLessThan(idxWa)

    const tg = convs.find((c) => c.key === `tg:${tgClientId}`)
    expect(tg?.unreadCount).toBe(2)
    const ig = convs.find((c) => c.key === `ig:${igClientId}`)
    expect(ig?.unreadCount).toBe(1)
    const wa = convs.find((c) => c.key === `wa:${waConvId}`)
    expect(wa?.unreadCount).toBe(2)
    expect(wa?.contactHandle).toBe(waPhone)
  })

  it('aislamiento multi-tenant: org-b solo ve lo suyo', async () => {
    const res = await inboxGET(req('/inbox', { token: tokenB() }))
    const body = await jsonBody(res)
    const convs = body.conversations as Array<{ channel: string; clientId: string | null }>
    expect(convs.length).toBeGreaterThanOrEqual(1)
    expect(convs.every((c) => c.channel === 'telegram')).toBe(true)
    expect(convs.every((c) => c.clientId === FIX.clientB1.id)).toBe(true)
  })
})

describe('GET /api/inbox?key=... — hilo y marca de leída', () => {
  it('key inválida → 400', async () => {
    const res = await inboxGET(req('/inbox?key=facebook:x', { token: tokenA() }))
    expect(res.status).toBe(400)
  })

  it('hilo de WhatsApp en orden ascendente + unreadCount a 0', async () => {
    const res = await inboxGET(req(`/inbox?key=${encodeURIComponent(`wa:${waConvId}`)}`, { token: tokenA() }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const msgs = body.messages as Array<{ text: string; direction: string }>
    expect(msgs.map((m) => m.text)).toEqual(['Hola', '¡Hola! Bienvenido'])

    const conv = await db.whatsAppConversation.findUnique({ where: { id: waConvId }, select: { unreadCount: true } })
    expect(conv?.unreadCount).toBe(0)
  })

  it('hilo de Telegram normalizado + readAt escrito en los entrantes', async () => {
    const res = await inboxGET(req(`/inbox?key=${encodeURIComponent(`tg:${tgClientId}`)}`, { token: tokenA() }))
    const body = await jsonBody(res)
    const msgs = body.messages as Array<{ direction: string; senderType: string; text: string }>
    expect(msgs.map((m) => m.text)).toEqual(['Primera pregunta', 'Respuesta del agente', 'Segunda pregunta'])
    expect(msgs.map((m) => m.senderType)).toEqual(['contact', 'agent', 'contact'])

    const unreadAfter = await db.timelineEvent.findMany({
      where: { organizationId: FIX.orgA.id, type: 'telegram', clientId: tgClientId },
    })
    const inEvents = unreadAfter.filter((e) => {
      const meta = JSON.parse(e.metadata || '{}') as Record<string, unknown>
      return meta.direction === 'in'
    })
    expect(inEvents.every((e) => {
      const meta = JSON.parse(e.metadata || '{}') as Record<string, unknown>
      return Boolean(meta.readAt)
    })).toBe(true)
  })
})

describe('POST /api/inbox/send', () => {
  it('sin sesión → 401', async () => {
    const res = await inboxSendPOST(req('/inbox/send', { method: 'POST', body: { key: 'wa:x', text: 'hola' } }))
    expect(res.status).toBe(401)
  })

  it('key inválida → 400', async () => {
    const res = await inboxSendPOST(req('/inbox/send', { method: 'POST', token: tokenA(), body: { key: 'fb:x', contactHandle: 'y', text: 'hola' } }))
    expect(res.status).toBe(409)
    expect(await jsonBody(res)).toMatchObject({ code: 'LEGACY_SEND_DISABLED' })
  })

  it('texto vacío → 400 (nunca envía)', async () => {
    const res = await inboxSendPOST(req('/inbox/send', { method: 'POST', token: tokenA(), body: { key: `wa:${waConvId}`, contactHandle: waPhone, text: '   ' } }))
    expect(res.status).toBe(400)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/vacío/i)
  })

  it('bloquea envíos legacy de WhatsApp y Telegram sin llamar a ningún proveedor', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const whatsapp = await inboxSendPOST(req('/inbox/send', {
        method: 'POST', token: tokenA(),
        body: { key: `wa:${waConvId}`, contactHandle: waPhone, text: 'No debe salir' },
      }))
      const telegram = await inboxSendPOST(req('/inbox/send', {
        method: 'POST', token: tokenA(),
        body: { key: `tg:${tgClientId}`, contactHandle: '555001', clientId: tgClientId, text: 'No debe salir' },
      }))
      expect(whatsapp.status).toBe(409)
      expect(telegram.status).toBe(409)
      expect(await jsonBody(whatsapp)).toMatchObject({ code: 'LEGACY_SEND_DISABLED' })
      expect(await jsonBody(telegram)).toMatchObject({ code: 'LEGACY_SEND_DISABLED' })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})


describe('POST /api/inbox/send — conversaciones canónicas (outbox)', () => {
  const connectionIds: string[] = []
  const conversationIds: string[] = []

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (conversationIds.length) {
      await db.channelOutboundMessage.deleteMany({ where: { conversationId: { in: conversationIds } } })
      await db.channelMessage.deleteMany({ where: { conversationId: { in: conversationIds } } })
      await db.channelConversation.deleteMany({ where: { id: { in: conversationIds } } })
      conversationIds.length = 0
    }
    if (connectionIds.length) {
      await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
      await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
      connectionIds.length = 0
    }
  })

  async function createCanonicalConversation(orgId: string = FIX.orgA.id) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const connection = await db.channelConnection.create({
      data: {
        id: `route-outbox-connection-${suffix}`,
        organizationId: orgId,
        channel: 'instagram',
        provider: 'meta_graph',
        providerAccountKey: `meta:instagram:route-outbox:${suffix}`,
        externalAccountId: `route-outbox-account-${suffix}`,
        displayName: 'Instagram de pruebas',
        credentialsEnc: 'v1:test-ciphertext',
        status: 'connected',
      },
    })
    connectionIds.push(connection.id)
    const conversation = await db.channelConversation.create({
      data: {
        id: `route-outbox-conversation-${suffix}`,
        organizationId: orgId,
        connectionId: connection.id,
        channel: 'instagram',
        externalContactKey: `contact-${suffix}`,
      },
    })
    conversationIds.push(conversation.id)
    return { connection, conversation }
  }

  it('encola y responde 202 sin llamar al proveedor ni al envío legacy', async () => {
    const { conversation } = await createCanonicalConversation()
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: {
        key: `cc:${conversation.id}`,
        clientRequestId: 'route-request-0001',
        contactHandle: 'no-se-usa-en-canonico',
        text: 'Respuesta persistida, todavía no enviada',
      },
    }))

    expect(res.status).toBe(202)
    expect(await jsonBody(res)).toMatchObject({
      success: true,
      queued: true,
      sent: false,
      status: 'queued',
      clientRequestId: 'route-request-0001',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await db.channelOutboundMessage.count({ where: { conversationId: conversation.id } })).toBe(1)
  })

  it('reintento HTTP con el mismo requestId devuelve la misma intención; cuerpo distinto entra en conflicto', async () => {
    const { conversation } = await createCanonicalConversation()
    const request = (text: string) => inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: `cc:${conversation.id}`, clientRequestId: 'route-request-idem-01', text },
    }))

    const first = await request('Mensaje idempotente')
    const firstBody = await jsonBody(first)
    const retry = await request('Mensaje idempotente')
    const retryBody = await jsonBody(retry)
    expect(first.status).toBe(202)
    expect(retry.status).toBe(202)
    expect(retryBody.outboundId).toBe(firstBody.outboundId)

    const conflict = await request('Texto diferente')
    expect(conflict.status).toBe(409)
    expect(await db.channelOutboundMessage.count({ where: { conversationId: conversation.id } })).toBe(1)
  })

  it('requiere clientRequestId y no crea una intención incompleta', async () => {
    const { conversation } = await createCanonicalConversation()
    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: `cc:${conversation.id}`, text: 'No encolar sin clave' },
    }))
    expect(res.status).toBe(400)
    expect(await db.channelOutboundMessage.count({ where: { conversationId: conversation.id } })).toBe(0)
  })

  it('no permite encolar una conversación de otro tenant', async () => {
    const { conversation } = await createCanonicalConversation(FIX.orgB.id)
    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: `cc:${conversation.id}`, clientRequestId: 'route-request-0002', text: 'No cruzar tenants' },
    }))
    expect(res.status).toBe(404)
    expect(await db.channelOutboundMessage.count({ where: { conversationId: conversation.id } })).toBe(0)
  })

  it('rechaza provider/canal incompatibles y no cae al envío legacy', async () => {
    const { connection, conversation } = await createCanonicalConversation()
    await db.channelConnection.update({ where: { id: connection.id }, data: { provider: 'meta_cloud' } })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await inboxSendPOST(req('/inbox/send', {
      method: 'POST',
      token: tokenA(),
      body: { key: `cc:${conversation.id}`, clientRequestId: 'route-request-0003', text: 'No fallback' },
    }))
    expect(res.status).toBe(409)
    expect(await db.channelOutboundMessage.count({ where: { conversationId: conversation.id } })).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
