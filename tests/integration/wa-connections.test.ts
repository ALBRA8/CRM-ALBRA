import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { GET as connectionsGet, POST as connectionsPost } from '@/app/api/whatsapp/connections/route'
import { GET as connectionGet, DELETE as connectionDelete } from '@/app/api/whatsapp/connections/[id]/route'
import { POST as connectionVerify } from '@/app/api/whatsapp/connections/[id]/verify/route'
import { GET as signupGet, POST as signupPost } from '@/app/api/whatsapp/embedded-signup/route'
import { GET as internalCredentialsGet } from '@/app/api/internal/whatsapp/credentials/route'
import { GET as webhookGet, POST as webhookPost } from '@/app/api/whatsapp/webhook/route'
import { db } from '@/lib/db'
import { getOrCreateChannelConversation } from '@/lib/channel-conversations'
import { claimChannelOutboundMessage, createChannelOutboundIntent } from '@/lib/channel-outbox'
import { FIX, jsonBody, req, routeParams, tokenA, tokenB, tokenFor } from '../helpers'

/**
 * OLEADA 2 — CONEXIONES WHATSAPP POR ORGANIZACIÓN (decisión de negocio 2026-11-11).
 *
 * Se ejercitan los 10 puntos de la arquitectura:
 *  1. una org conecta UNO o VARIOS números según su plan;
 *  2. credenciales propias por org, SIEMPRE cifradas en reposo;
 *  3. credenciales asociadas exclusivamente a su organization_id;
 *  4. atribución automática phoneNumberId → organización (webhook);
 *  5. CRM administra conexiones y permisos;
 *  8. una org jamás ve/usa/modifica conexiones de otra;
 *  9. desconexión/revocación aislada;
 * 10. Embedded Signup oficial (code→token server-side), sin contraseñas.
 */

async function ownerB(): Promise<string> {
  // La sesión de prueba debe reflejar el rol real de la BD, no solo el JWT.
  await db.user.update({ where: { id: FIX.userB.id }, data: { role: 'owner' } })
  return tokenFor({ ...FIX.userB, role: 'owner' })
}

/**
 * Stub de Graph API para las rutas que validan el token contra Meta (regla 9:
 * pruebas automatizadas SIN red real). La ruta de producción mantiene la
 * validación activa; en pruebas se inyecta la red.
 */
function stubGraphOk(phoneNumberId: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/me?')) return new Response(JSON.stringify({ id: `waba-${phoneNumberId}` }), { status: 200 })
    if (url.includes(`/${phoneNumberId}?`)) {
      return new Response(JSON.stringify({ id: phoneNumberId, phone_number: '+52 55 0000 0000', verified_name: 'Cuenta de Prueba' }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Crea una conexión sin tocar Graph API real (verifyAgainstGraph=false). */
async function seedConnection(orgId: string, phoneNumberId: string, opts: { status?: string } = {}) {
  const { createConnection } = await import('@/lib/wa-connections')
  const res = await createConnection({
    orgId,
    phoneNumberId,
    accessToken: `EAAG-token-de-prueba-${phoneNumberId}-0123456789`,
    verifyAgainstGraph: false,
  })
  if (!res.ok) throw new Error(`seedConnection falló: ${JSON.stringify(res)}`)
  if (opts.status && opts.status !== 'connected') {
    await db.whatsAppConnection.update({ where: { phoneNumberId }, data: { status: opts.status } })
  }
  return db.whatsAppConnection.findUnique({ where: { phoneNumberId } })
}

beforeEach(async () => {
  // Limpieza determinista del área bajo prueba (las demás tablas quedan intactas).
  await db.channelConnectionEvent.deleteMany()
  await db.channelConnection.deleteMany({ where: { provider: 'meta_cloud' } })
  await db.whatsAppConnectionEvent.deleteMany()
  await db.whatsAppConnection.deleteMany()
})

afterEach(async () => {
  await db.user.update({ where: { id: FIX.userB.id }, data: { role: 'member' } })
  delete process.env.INTERNAL_API_KEYS
  delete process.env.META_APP_ID
  delete process.env.META_APP_SECRET
  delete process.env.META_APP_SECRET_test
  vi.unstubAllGlobals()
})

describe('OLEADA 2 — credenciales cifradas y asociadas a su organización', () => {
  it('el token se guarda CIFRADO en BD y jamás aparece en las respuestas de API', async () => {
    const conn = await seedConnection('org-a', '111000111')
    expect(conn).toBeTruthy()
    expect(conn!.accessTokenEnc).not.toContain('EAAG-token-de-prueba') // en claro NUNCA en reposo
    expect(conn!.accessTokenEnc.startsWith('v1:')).toBe(true) // blob AES-256-GCM
    const { decryptSecret } = await import('@/lib/crypto')
    expect(decryptSecret(conn!.accessTokenEnc)).toBe(`EAAG-token-de-prueba-111000111-0123456789`)

    const res = await connectionsGet(req('/api/whatsapp/connections', { token: tokenA() }))
    const text = JSON.stringify(await jsonBody(res))
    expect(res.status).toBe(200)
    expect(text).not.toContain('EAAG-token-de-prueba')
    expect(text).not.toContain('accessTokenEnc')
  })

  it('creación manual por owner (flujo admin) queda conectada y auditada', async () => {
    stubGraphOk('222000222')
    const res = await connectionsPost(req('/api/whatsapp/connections', {
      token: tokenFor({ ...FIX.userA, role: 'owner' }),
      method: 'POST',
      body: { phoneNumberId: '222000222', accessToken: 'EAAG-token-admin-0123456789' },
    }))
    expect(res.status).toBe(201)
    const events = await db.whatsAppConnectionEvent.findMany({ where: { type: 'connected' } })
    expect(events).toHaveLength(1)
    expect(events[0].organizationId).toBe('org-a')

    const canonical = await db.channelConnection.findUnique({
      where: { providerAccountKey: 'meta:whatsapp:222000222' },
    })
    expect(canonical).toMatchObject({
      organizationId: 'org-a',
      channel: 'whatsapp',
      provider: 'meta_cloud',
      externalAccountId: '222000222',
      status: 'connected',
    })
    expect(canonical!.credentialsEnc).not.toContain('EAAG-token-admin')
    const { decryptSecret } = await import('@/lib/crypto')
    expect(JSON.parse(decryptSecret(canonical!.credentialsEnc)!)).toMatchObject({
      accessToken: 'EAAG-token-admin-0123456789',
    })
  })

  it('un member (no admin) no puede conectar números (permiso, punto 5)', async () => {
    const res = await connectionsPost(req('/api/whatsapp/connections', {
      token: tokenB(), // userB es member de org-b
      method: 'POST',
      body: { phoneNumberId: '333000333', accessToken: 'EAAG-token-member-01234567' },
    }))
    expect(res.status).toBe(403)
  })
})

describe('OLEADA 2 — límite de números por plan (punto 1)', () => {
  it('plan pilot admite 1 número activo y bloquea el segundo con 402', async () => {
    const { planLimitFor } = await import('@/lib/whatsapp-plans')
    expect(planLimitFor('pilot').maxConnections).toBe(1)

    const r1 = await seedConnection('org-a', '444000444')
    expect(r1!.status).toBe('connected')
    const r2 = await connectionsPost(req('/api/whatsapp/connections', {
      token: tokenFor({ ...FIX.userA, role: 'owner' }),
      method: 'POST',
      body: { phoneNumberId: '555000555', accessToken: 'EAAG-token-excedente-012345' },
    }))
    expect(r2.status).toBe(402)
    const body = await jsonBody(r2)
    expect(body.error).toContain('plan')
    const blocked = await db.whatsAppConnectionEvent.findFirst({ where: { type: 'plan_limit_blocked' } })
    expect(blocked).toBeTruthy()
  })

  it('un plan superior permite varios números (una org, varios números)', async () => {
    await db.organization.update({ where: { id: 'org-a' }, data: { plan: 'growth' } })
    try {
      const a = await seedConnection('org-a', '666000666')
      const b = await seedConnection('org-a', '666000667')
      expect(a!.status).toBe('connected')
      expect(b!.status).toBe('connected')
      const list = await connectionsGet(req('/api/whatsapp/connections', { token: tokenA() }))
      const body = (await jsonBody(list)) as { connections: unknown[]; plan: { activeConnections: number; maxConnections: number } }
      expect(body.connections).toHaveLength(2)
      expect(body.plan.activeConnections).toBe(2)
      expect(body.plan.maxConnections).toBe(5)
    } finally {
      await db.organization.update({ where: { id: 'org-a' }, data: { plan: 'pilot' } })
    }
  })

  it('desconectar libera el cupo del plan', async () => {
    const conn = await seedConnection('org-a', '777000777')
    const del = await connectionDelete(
      req(`/api/whatsapp/connections/${conn!.id}`, { token: tokenFor({ ...FIX.userA, role: 'owner' }), method: 'DELETE' }),
      routeParams(conn!.id),
    )
    expect(del.status).toBe(200)
    const canonical = await db.channelConnection.findUnique({
      where: { providerAccountKey: 'meta:whatsapp:777000777' },
    })
    expect(canonical?.status).toBe('disconnected')
    expect(JSON.parse((await import('@/lib/crypto')).decryptSecret(canonical!.credentialsEnc)!)).toEqual({})
    stubGraphOk('777000778')
    const r2 = await connectionsPost(req('/api/whatsapp/connections', {
      token: tokenFor({ ...FIX.userA, role: 'owner' }),
      method: 'POST',
      body: { phoneNumberId: '777000778', accessToken: 'EAAG-token-postbaja-0123456' },
    }))
    expect(r2.status).toBe(201)
  })

  it('dos solicitudes simultáneas para conectar números distintos respetan el límite del plan (concurrencia atómica)', async () => {
    const { createConnection } = await import('@/lib/wa-connections')
    const [res1, res2] = await Promise.all([
      createConnection({
        orgId: 'org-a',
        phoneNumberId: '555000001',
        accessToken: 'EAAG-token-concurrente-1-0123456789', // scan-secrets:allow
        verifyAgainstGraph: false,
      }),
      createConnection({
        orgId: 'org-a',
        phoneNumberId: '555000002',
        accessToken: 'EAAG-token-concurrente-2-0123456789', // scan-secrets:allow
        verifyAgainstGraph: false,
      }),
    ])

    const successes = [res1, res2].filter((r) => r.ok === true)
    const blocked = [res1, res2].filter((r) => !r.ok && r.code === 'plan_limit')

    expect(successes).toHaveLength(1)
    expect(blocked).toHaveLength(1)

    const count = await db.whatsAppConnection.count({
      where: { organizationId: 'org-a', status: { in: ['connected', 'pending'] } },
    })
    expect(count).toBe(1)
  })

  it('dos solicitudes simultáneas con el MISMO número rechazan la duplicación sin colisión ni carrera', async () => {
    const { createConnection } = await import('@/lib/wa-connections')
    const [res1, res2] = await Promise.all([
      createConnection({
        orgId: 'org-a',
        phoneNumberId: '777000777',
        accessToken: 'EAAG-token-dup-1-0123456789', // scan-secrets:allow
        verifyAgainstGraph: false,
      }),
      createConnection({
        orgId: 'org-b',
        phoneNumberId: '777000777',
        accessToken: 'EAAG-token-dup-2-0123456789', // scan-secrets:allow
        verifyAgainstGraph: false,
      }),
    ])

    const successes = [res1, res2].filter((r) => r.ok === true)
    const duplicates = [res1, res2].filter((r) => !r.ok && r.code === 'duplicate')

    expect(successes).toHaveLength(1)
    expect(duplicates).toHaveLength(1)

    const allWithPhone = await db.whatsAppConnection.findMany({
      where: { phoneNumberId: '777000777' },
    })
    expect(allWithPhone).toHaveLength(1)
  })
})

describe('OLEADA 2 — aislamiento multi-organización (punto 8)', () => {
  it('la conexión de org-a es invisible para org-b (404, sin detalles)', async () => {
    const conn = await seedConnection('org-a', '888000888')
    const res = await connectionGet(req(`/api/whatsapp/connections/${conn!.id}`, { token: await ownerB() }), routeParams(conn!.id))
    expect(res.status).toBe(404)
    const text = JSON.stringify(await jsonBody(res))
    expect(text).not.toContain('org-a')
    expect(text).not.toContain('888000888')
  })

  it('org-b no puede desconectar la conexión de org-a (la conexión sobrevive intacta)', async () => {
    const conn = await seedConnection('org-a', '888000889')
    const res = await connectionDelete(
      req(`/api/whatsapp/connections/${conn!.id}`, { token: await ownerB(), method: 'DELETE' }),
      routeParams(conn!.id),
    )
    expect(res.status).toBe(404)
    const still = await db.whatsAppConnection.findUnique({ where: { phoneNumberId: '888000889' } })
    expect(still!.status).toBe('connected')
    expect(still!.accessTokenEnc).not.toBe('') // token no destruido
  })

  it('el listado de org-b nunca incluye conexiones de org-a', async () => {
    await seedConnection('org-a', '888000890')
    const res = await connectionsGet(req('/api/whatsapp/connections', { token: await ownerB() }))
    const body = await jsonBody(res)
    expect(body.connections).toHaveLength(0)
  })

  it('un token de org-b no puede pedir un phoneNumberId de org-a (404 sin revelar existencia)', async () => {
    await seedConnection('org-a', '888000891')
    process.env.INTERNAL_API_KEYS = 'org-b:clave-de-servicio-b-0123456789:admin'
    const res = await internalCredentialsGet(
      req('/api/internal/whatsapp/credentials?phoneNumberId=888000891', {
        token: undefined,
        headers: { authorization: 'Bearer clave-de-servicio-b-0123456789' },
      }),
    )
    expect(res.status).toBe(404)
    const body = await jsonBody(res)
    expect(JSON.stringify(body)).not.toContain('EAAG')
    expect(JSON.stringify(body)).not.toContain('org-a')
  })

  it('sin credencial de servicio no hay resolución de credenciales (fail-closed)', async () => {
    await seedConnection('org-a', '888000892')
    const res = await internalCredentialsGet(req('/api/internal/whatsapp/credentials?phoneNumberId=888000892'))
    expect(res.status).toBe(401)
  })
})

describe('OLEADA 2 — resolución interna de credenciales para WHATSPOWER/ULTRA (puntos 6 y 7)', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_KEYS = 'org-a:clave-de-servicio-a-0123456789:admin'
  })

  it('la org autenticada resuelve SU token por phoneNumberId (token en claro por canal autenticado)', async () => {
    const conn = await seedConnection('org-a', '999000999')
    const res = await internalCredentialsGet(
      req('/api/internal/whatsapp/credentials?phoneNumberId=999000999', {
        headers: { authorization: 'Bearer clave-de-servicio-a-0123456789' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.organizationId).toBe('org-a')
    expect(body.connectionId).toBe(conn!.id)
    expect(body.accessToken).toBe(`EAAG-token-de-prueba-999000999-0123456789`)
    expect(body.phoneNumberId).toBe('999000999')
  })

  it('inventario de conexiones de la org autenticada SIN tokens (para WHATSPOWER/ULTRA)', async () => {
    await seedConnection('org-a', '999001010')
    await seedConnection('org-b', '999001011')
    const res = await internalCredentialsGet(
      req('/api/internal/whatsapp/credentials', {
        headers: { authorization: 'Bearer clave-de-servicio-a-0123456789' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.organizationId).toBe('org-a')
    const connections = body.connections as Array<{ phoneNumberId: string }>
    expect(connections).toHaveLength(1)
    expect(connections[0].phoneNumberId).toBe('999001010')
    expect(JSON.stringify(body)).not.toContain('accessToken')
    expect(JSON.stringify(body)).not.toContain('EAAG')
  })

  it('credencial de rol agent NO puede resolver credenciales (solo admin de la org)', async () => {
    await seedConnection('org-a', '999001000')
    process.env.INTERNAL_API_KEYS = 'org-a:clave-de-agente-a-01234567890:agent'
    const res = await internalCredentialsGet(
      req('/api/internal/whatsapp/credentials?phoneNumberId=999001000', {
        headers: { authorization: 'Bearer clave-de-agente-a-01234567890' },
      }),
    )
    expect(res.status).toBe(403)
  })

  it('phoneNumberId inexistente → 404 limpio', async () => {
    const res = await internalCredentialsGet(
      req('/api/internal/whatsapp/credentials?phoneNumberId=000000000', {
        headers: { authorization: 'Bearer clave-de-servicio-a-0123456789' },
      }),
    )
    expect(res.status).toBe(404)
  })

  it('conexión desconectada → 409 (sin token)', async () => {
    await seedConnection('org-a', '999001001', { status: 'disconnected' })
    const res = await internalCredentialsGet(
      req('/api/internal/whatsapp/credentials?phoneNumberId=999001001', {
        headers: { authorization: 'Bearer clave-de-servicio-a-0123456789' },
      }),
    )
    expect(res.status).toBe(409)
  })
})

describe('OLEADA 2 — desconexión/revocación aislada (punto 9)', () => {
  it('revocar la conexión de org-a NO afecta a la conexión de org-b', async () => {
    const connA = await seedConnection('org-a', '101000101')
    const connB = await seedConnection('org-b', '101000102')
    const res = await connectionDelete(
      req(`/api/whatsapp/connections/${connA!.id}`, {
        token: tokenFor({ ...FIX.userA, role: 'owner' }),
        method: 'DELETE',
        body: { revoked: true },
      }),
      routeParams(connA!.id),
    )
    expect(res.status).toBe(200)
    const afterA = await db.whatsAppConnection.findUnique({ where: { id: connA!.id } })
    const afterB = await db.whatsAppConnection.findUnique({ where: { id: connB!.id } })
    expect(afterA!.status).toBe('revoked')
    expect(afterA!.accessTokenEnc).toBe('') // material destruido
    expect(afterB!.status).toBe('connected') // la otra org intacta
    expect(afterB!.accessTokenEnc).not.toBe('')
  })
})

describe('OLEADA 2 — webhook Meta: atribución automática por número (punto 4)', () => {
  const APP_SECRET_TEST = 'test-app-secret-meta-0123456789abcdef'
  const WEBHOOK_BODY = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550101', phone_number_id: '121000121' },
          contacts: [{ wa_id: '5215512345678', profile: { name: 'Contacto Webhook' } }],
          messages: [{ from: '5215512345678', id: 'wamid.test-1', timestamp: '1710000000', type: 'text', text: { body: 'hola' } }],
        },
      }],
    }],
  }

  function signedBody(): { body: string; signature: string } {
    const raw = JSON.stringify(WEBHOOK_BODY)
    const signature = 'sha256=' + createHmac('sha256', APP_SECRET_TEST).update(raw).digest('hex')
    return { body: raw, signature }
  }

  beforeEach(() => {
    process.env.META_APP_SECRET = APP_SECRET_TEST
    // Silencia los efectos colaterales del bridge (fire-and-forget) en tests.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('el mensaje entrante se atribuye a la org de la conexión (no al body)', async () => {
    await seedConnection('org-a', '121000121')
    const { body, signature } = signedBody()
    const request = new (await import('next/server')).NextRequest('http://localhost:3000/api/whatsapp/webhook', {
      method: 'POST',
      body,
      headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': signature }),
    })
    const res = await webhookPost(request)
    expect(res.status).toBe(200)
    const payload = await jsonBody(res)
    expect(payload.ok).toBe(true)
    // El timeline de org-a recibió el evento del número de org-a (el mensaje
    // entrante se atribuyó por la conexión, no por el body).
    const timeline = await db.timelineEvent.findMany({
      where: { organizationId: 'org-a', type: 'whatsapp' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    expect(timeline.length).toBeGreaterThan(0)
    expect(JSON.stringify(timeline)).toContain('Contacto Webhook')
  })

  it('procesa status callbacks batch de dos números/tenants y los reconcilia por opaque callback data', async () => {
    const connA = await seedConnection('org-a', '121000201')
    const connB = await seedConnection('org-b', '121000202')
    const canonicalA = await db.channelConnection.findUnique({ where: { providerAccountKey: 'meta:whatsapp:121000201' }, select: { id: true } })
    const canonicalB = await db.channelConnection.findUnique({ where: { providerAccountKey: 'meta:whatsapp:121000202' }, select: { id: true } })
    expect(canonicalA).not.toBeNull()
    expect(canonicalB).not.toBeNull()
    const conversationA = await getOrCreateChannelConversation({
      providerAccountKey: 'meta:whatsapp:121000201',
      channel: 'whatsapp',
      externalContactKey: '5215512345601',
    })
    const conversationB = await getOrCreateChannelConversation({
      providerAccountKey: 'meta:whatsapp:121000202',
      channel: 'whatsapp',
      externalContactKey: '5215512345602',
    })
    expect(conversationA).not.toBeNull()
    expect(conversationB).not.toBeNull()
    const outboundA = await createChannelOutboundIntent({
      organizationId: 'org-a',
      conversationId: conversationA!.id,
      clientRequestId: 'request-batch-status-a',
      body: 'Mensaje de prueba A',
    })
    const outboundB = await createChannelOutboundIntent({
      organizationId: 'org-b',
      conversationId: conversationB!.id,
      clientRequestId: 'request-batch-status-b',
      body: 'Mensaje de prueba B',
    })
    await claimChannelOutboundMessage(outboundA.id)
    await claimChannelOutboundMessage(outboundB.id)

    const batchBody = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-a',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550201', phone_number_id: '121000201' },
              statuses: [{
                id: 'wamid.batch-a',
                status: 'delivered',
                timestamp: '1794500001',
                biz_opaque_callback_data: outboundA.id,
              }],
            },
          }],
        },
        {
          id: 'waba-b',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550202', phone_number_id: '121000202' },
              statuses: [{
                id: 'wamid.batch-b',
                status: 'read',
                timestamp: '1794500002',
                biz_opaque_callback_data: outboundB.id,
              }],
            },
          }],
        },
      ],
    }
    const raw = JSON.stringify(batchBody)
    const signature = 'sha256=' + createHmac('sha256', APP_SECRET_TEST).update(raw).digest('hex')
    const NextRequest = (await import('next/server')).NextRequest
    const response = await webhookPost(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
      method: 'POST',
      body: raw,
      headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': signature }),
    }))
    expect(response.status).toBe(200)

    const [storedA, storedB] = await Promise.all([
      db.channelOutboundMessage.findUnique({ where: { id: outboundA.id } }),
      db.channelOutboundMessage.findUnique({ where: { id: outboundB.id } }),
    ])
    expect(storedA?.status).toBe('sent')
    expect(storedB?.status).toBe('sent')
    const [messageA, messageB] = await Promise.all([
      db.channelMessage.findUnique({ where: { conversationId_externalMessageId: { conversationId: conversationA!.id, externalMessageId: 'wamid.batch-a' } } }),
      db.channelMessage.findUnique({ where: { conversationId_externalMessageId: { conversationId: conversationB!.id, externalMessageId: 'wamid.batch-b' } } }),
    ])
    expect(JSON.parse(messageA?.metadata || '{}').deliveryStatus).toBe('delivered')
    expect(JSON.parse(messageB?.metadata || '{}').deliveryStatus).toBe('read')
    expect(await db.channelWebhookEvent.count({ where: { connectionId: { in: [canonicalA!.id, canonicalB!.id] }, status: 'processed' } })).toBe(2)

    // Repetir exactamente el mismo batch no duplica los eventos ni mensajes.
    const duplicate = await webhookPost(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
      method: 'POST',
      body: raw,
      headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': signature }),
    }))
    expect(duplicate.status).toBe(200)
    expect(await db.channelMessage.count({ where: { conversationId: { in: [conversationA!.id, conversationB!.id] } } })).toBe(2)
    expect(await db.channelWebhookEvent.count({ where: { connectionId: { in: [canonicalA!.id, canonicalB!.id] } } })).toBe(2)
  })

  it('un phoneNumberId sin conexión conectada → 401 (ni fallback a org "dicha" por el body)', async () => {
    await seedConnection('org-a', '121000122', { status: 'disconnected' })
    const { body, signature } = signedBody()
    const raw = body.replace('121000121', '121000122')
    const signature2 = 'sha256=' + createHmac('sha256', APP_SECRET_TEST).update(raw).digest('hex')
    const request = new (await import('next/server')).NextRequest('http://localhost:3000/api/whatsapp/webhook', {
      method: 'POST',
      body: raw,
      headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': signature2 }),
    })
    const res = await webhookPost(request)
    expect(res.status).toBe(401)
  })

  it('firma inválida → 401 aunque el phoneNumberId exista', async () => {
    await seedConnection('org-a', '121000123')
    const request = new (await import('next/server')).NextRequest('http://localhost:3000/api/whatsapp/webhook', {
      method: 'POST',
      body: JSON.stringify(WEBHOOK_BODY),
      headers: new Headers({ 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' }),
    })
    const res = await webhookPost(request)
    expect(res.status).toBe(401)
  })

  it('la verificación GET del webhook responde con el challenge del verify_token POR conexión', async () => {
    const conn = await seedConnection('org-a', '121000124')
    const res = await webhookGet(req(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(conn!.webhookVerifyToken)}&hub.challenge=CHALLENGE-42`))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('CHALLENGE-42')
  })

  it('un verify_token ajeno no verifica la suscripción (403)', async () => {
    await seedConnection('org-a', '121000125')
    const res = await webhookGet(req('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=otro-token&hub.challenge=X'))
    expect(res.status).toBe(403)
  })
})

describe('OLEADA 2 — Embedded Signup oficial (punto 10, sin contraseñas)', () => {
  it('GET entrega appId + state firmado y JAMÁS el app secret', async () => {
    process.env.META_APP_ID = 'app-id-test'
    process.env.META_APP_SECRET = 'app-secret-test-0123456789'
    const res = await signupGet(req('/api/whatsapp/embedded-signup', { token: tokenA() }))
    expect(res.status).toBe(200)
    const body = (await jsonBody(res)) as { appId: string; state: string }
    expect(body.appId).toBe('app-id-test')
    expect(body.state.split('.')).toHaveLength(4)
    expect(JSON.stringify(body)).not.toContain('app-secret-test')
  })

  it('POST intercambia code→token server-side, verifica el número y registra cifrado', async () => {
    process.env.META_APP_ID = 'app-id-test'
    process.env.META_APP_SECRET = 'app-secret-test-0123456789'
    const configRes = await signupGet(req('/api/whatsapp/embedded-signup', { token: tokenA() }))
    const { state } = await jsonBody(configRes)

    // Stub de Graph API (regla 9: pruebas automatizadas sin red real).
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'EAAG-token-embedded-0123456789', token_type: 'bearer' }), { status: 200 })
      }
      if (url.includes('/me?')) {
        return new Response(JSON.stringify({ id: 'waba-owner-1' }), { status: 200 })
      }
      if (url.includes('/131000131?')) {
        return new Response(JSON.stringify({ id: '131000131', phone_number: '+52 55 1010 1010', verified_name: 'Alfa Demo' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await signupPost(req('/api/whatsapp/embedded-signup', {
      token: tokenA(),
      method: 'POST',
      body: { code: 'AQC-authorization-code', state, phoneNumberId: '131000131', wabaId: 'waba-alfa' },
    }))
    expect(res.status).toBe(201)
    const body = await jsonBody(res)
    expect(body.ok).toBe(true)

    const conn = await db.whatsAppConnection.findUnique({ where: { phoneNumberId: '131000131' } })
    expect(conn!.status).toBe('connected')
    expect(conn!.source).toBe('embedded_signup')
    expect(conn!.wabaId).toBe('waba-alfa')
    expect(conn!.displayName).toBe('Alfa Demo')
    expect(conn!.accessTokenEnc).not.toContain('EAAG-token-embedded') // cifrado
    // El canje se hizo contra el endpoint de OAuth con client_id + client_secret:
    const oauthUrl = String(fetchMock.mock.calls[0][0])
    expect(oauthUrl).toContain('client_id=app-id-test')
    expect(oauthUrl).toContain('client_secret=app-secret-test-0123456789')
    expect(oauthUrl).toContain('code=AQC-authorization-code')
  })

  it('state de otra organización o manipulado → 403/400', async () => {
    process.env.META_APP_ID = 'app-id-test'
    process.env.META_APP_SECRET = 'app-secret-test-0123456789'
    const configRes = await signupGet(req('/api/whatsapp/embedded-signup', { token: tokenA() }))
    const { state } = await jsonBody(configRes)
    // userB (org-b) reutiliza el estado firmado para org-a.
    const res = await signupPost(req('/api/whatsapp/embedded-signup', {
      token: await ownerB(),
      method: 'POST',
      body: { code: 'AQC-x', state, phoneNumberId: '131000132' },
    }))
    expect(res.status).toBe(403)
    const res2 = await signupPost(req('/api/whatsapp/embedded-signup', {
      token: tokenA(),
      method: 'POST',
      body: { code: 'AQC-x', state: 'org-a.falsificado.9999999999999.deadbeef', phoneNumberId: '131000133' },
    }))
    expect(res2.status).toBe(400)
  })
})
