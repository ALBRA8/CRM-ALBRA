import { describe, expect, it, vi } from 'vitest'
import { GET as clientsGet } from '@/app/api/clients/[id]/route'
import { PUT as clientsPut } from '@/app/api/clients/[id]/route'
import { GET as oppsGet } from '@/app/api/opportunities/[id]/route'
import { PUT as oppsPut } from '@/app/api/opportunities/[id]/route'
import { GET as quotesGet } from '@/app/api/quotes/[id]/route'
import { PUT as autosPut } from '@/app/api/automations/[id]/route'
import { GET as teamGet } from '@/app/api/team/route'
import { GET as backupGet } from '@/app/api/backup/route'
import { GET as settingsGet } from '@/app/api/settings/route'
import { POST as memoryPost } from '@/app/api/memory/route'
import { GET as memoryGet } from '@/app/api/memory/route'
import { GET as daemonGet, POST as daemonPost, PUT as daemonPut } from '@/app/api/whatsapp/daemon-proxy/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, routeParams, tokenA, tokenB, tokenFor } from '../helpers'

/**
 * BATERÍA MULTI-TENANT P0 (§29 del cierre de producción):
 * Org A (owner) vs Org B (member). Nada de org A debe ser leíble ni
 * modificable por org B: API, memoria, automatizaciones, WhatsApp (proxy),
 * documentos y manipulación de IDs.
 */

const ownerB = (): string => tokenFor({ ...FIX.userB, role: 'owner' })

describe('MULTI-TENANT P0 — lectura cruzada de entidades', () => {
  it('cliente de A invisible para B (GET directo por id → 404)', async () => {
    const res = await clientsGet(req('/api/clients/client-a1', { token: tokenB() }), routeParams('client-a1'))
    expect(res.status).toBe(404)
  })

  it('cliente de A no modificable por B (PUT directo → 404, sin cambios)', async () => {
    const res = await clientsPut(req('/api/clients/client-a1', { token: tokenB(), method: 'PUT', body: { name: 'HACKEADO' } }), routeParams('client-a1'))
    expect(res.status).toBe(404)
    const still = await db.client.findUnique({ where: { id: 'client-a1' } })
    expect(still?.name).toBe('Cliente Alpha')
  })

  it('oportunidad de A invisible para B', async () => {
    const opp = await db.opportunity.create({ data: { organizationId: 'org-a', title: 'Opp secreta A', clientId: 'client-a1', status: 'open' } })
    try {
      const res = await oppsGet(req(`/api/opportunities/${opp.id}`, { token: tokenB() }), routeParams(opp.id))
      expect(res.status).toBe(404)
    } finally {
      await db.opportunity.delete({ where: { id: opp.id } })
    }
  })

  it('cotización de A invisible para B', async () => {
    const quote = await db.quote.create({ data: { organizationId: 'org-a', number: 'COT-TEST-1', clientId: 'client-a1', subtotal: 10, tax: 0, total: 10, status: 'draft' } })
    try {
      const res = await quotesGet(req(`/api/quotes/${quote.id}`, { token: tokenB() }), routeParams(quote.id))
      expect(res.status).toBe(404)
    } finally {
      await db.quote.delete({ where: { id: quote.id } })
    }
  })

  it('equipo de B solo muestra usuarios de B', async () => {
    const res = await teamGet(req('/api/team', { token: ownerB() }))
    const body = await jsonBody(res)
    const users = (body.users ?? body.team ?? []) as Array<{ id: string }>
    expect(users.every((u) => !u.id.startsWith('user-a'))).toBe(true)
  })

  it('settings de B no revelan datos de A', async () => {
    const res = await settingsGet(req('/api/settings', { token: ownerB() }))
    expect(res.status).toBe(200)
    const text = JSON.stringify(await jsonBody(res))
    expect(text).not.toContain('org-a')
  })
})

describe('MULTI-TENANT P0 — memoria y automatizaciones', () => {
  it('B no puede crear memoria apuntando a cliente de A (404)', async () => {
    const res = await memoryPost(req('/api/memory', { token: ownerB(), method: 'POST', body: { clientId: 'client-a1', content: 'memoria pirata' } }))
    expect(res.status).toBe(404)
  })

  it('B no ve memorias de A (listado filtrado por org+clientId)', async () => {
    await db.agentMemory.create({ data: { organizationId: 'org-a', clientId: 'client-a1', content: 'prefiere pagar contraentrega', type: 'preference', source: 'manual', importance: 3 } })
    const res = await memoryGet(req('/api/memory?clientId=client-a1', { token: ownerB() }))
    const body = await jsonBody(res)
    const memories = (body.memories ?? []) as Array<{ content: string }>
    expect(memories.every((m) => !m.content.includes('contraentrega'))).toBe(true)
  })

  it('automatización de A no modificable por B (PUT → 404)', async () => {
    const auto = await db.automation.create({ data: { organizationId: 'org-a', name: 'Auto A', triggerType: 'client_created', conditions: '[]', actions: '[]', isActive: true } })
    try {
      const res = await autosPut(req(`/api/automations/${auto.id}`, { token: ownerB(), method: 'PUT', body: { name: 'SECUESTRADA' } }), routeParams(auto.id))
      expect(res.status).toBe(404)
      const still = await db.automation.findUnique({ where: { id: auto.id } })
      expect(still?.name).toBe('Auto A')
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})

describe('MULTI-TENANT P0 — WhatsApp (proxy al daemon compartido)', () => {
  it('con daemon vinculado a org A: B recibe 403 en conversaciones/send/conectar', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const url = String(_url)
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ status: 'connected', linkedOrgId: 'org-a', orgLinked: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ conversations: [] }), { status: 200 })
    }))
    try {
      const convs = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/conversations', { token: tokenB() }))
      expect(convs.status).toBe(403)
      const send = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenB(), method: 'POST', body: { path: '/send', to: '+573001110000', text: 'hola' } }))
      expect(send.status).toBe(403)
      const connect = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenB(), method: 'POST', body: { path: '/connect' } }))
      expect(connect.status).toBe(403)
      const upd = await daemonPut(req('/api/whatsapp/daemon-proxy', { token: tokenB(), method: 'PUT', body: { path: '/conversations/conv-x', isAutoReply: false } }))
      expect(upd.status).toBe(403)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('el dueño de la org vinculada (A) SÍ opera con normalidad', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL) => {
      const url = String(_url)
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ status: 'connected', linkedOrgId: 'org-a', orgLinked: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ conversations: [{ id: 'conv-1', contactPhone: '+573001110000' }] }), { status: 200 })
    }))
    try {
      const convs = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/conversations', { token: tokenA() }))
      expect(convs.status).toBe(200)
      const body = await jsonBody(convs)
      expect(Array.isArray(body.conversations)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('MULTI-TENANT P0 — documentos/exportaciones', () => {
  it('el backup JSON de B no contiene datos de A', async () => {
    const res = await backupGet(req('/api/backup', { token: ownerB() }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('Cliente Alpha')
    expect(text).toContain('Cliente Beta Org B')
  })
})

// ============================================================
// FAIL-CLOSED (auditoría pre-venta P0 + regresión del CI rojo):
// la duda NUNCA se resuelve a favor del llamador. Si la propiedad de la
// sesión no puede verificarse (daemon caído, status no-ok, respuesta
// ambigua) la operación se DENIEGA — para B y también para A.
// ============================================================
describe('MULTI-TENANT P0 — WhatsApp fail-closed (ownership no verificable)', () => {
  it('daemon CAÍDO (fetch rechaza): B recibe 403 y A también (fail-closed total)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED: daemon caído')
    }))
    try {
      const sendB = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenB(), method: 'POST', body: { path: '/send', to: '+573001110000', text: 'hola' } }))
      expect(sendB.status).toBe(403)
      const convsB = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/conversations', { token: tokenB() }))
      expect(convsB.status).toBe(403)
      // Ni el dueño legítimo opera cuando no se puede verificar propiedad
      const sendA = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenA(), method: 'POST', body: { path: '/send', to: '+573001110000', text: 'hola' } }))
      expect(sendA.status).toBe(403)
      const statusA = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/status', { token: tokenA() }))
      expect(statusA.status).toBe(403)
      const connectA = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenA(), method: 'POST', body: { path: '/connect' } }))
      expect(connectA.status).toBe(403)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('daemon /status responde 500 (error consultando ownership) → DENIED 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL) => {
      const url = String(_url)
      if (url.endsWith('/status')) return new Response('internal error', { status: 500 })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
    try {
      const sendA = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenA(), method: 'POST', body: { path: '/send', to: '+573001110000', text: 'hola' } }))
      expect(sendA.status).toBe(403)
      const disconnectB = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenB(), method: 'POST', body: { path: '/disconnect' } }))
      expect(disconnectB.status).toBe(403)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('respuesta AMBIGUA (200 sin orgLinked boolean) → DENIED 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL) => {
      const url = String(_url)
      if (url.endsWith('/status')) return new Response(JSON.stringify({ status: 'connected' }), { status: 200 })
      return new Response(JSON.stringify({ conversations: [] }), { status: 200 })
    }))
    try {
      const convsA = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/conversations', { token: tokenA() }))
      expect(convsA.status).toBe(403)
      const sendA = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenA(), method: 'POST', body: { path: '/send', to: '+573001110000', text: 'hola' } }))
      expect(sendA.status).toBe(403)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('orgLinked:true pero linkedOrgId ausente → DENIED 403 (no se infiere propiedad)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL) => {
      const url = String(_url)
      if (url.endsWith('/status')) return new Response(JSON.stringify({ status: 'connected', orgLinked: true }), { status: 200 })
      return new Response(JSON.stringify({ conversations: [] }), { status: 200 })
    }))
    try {
      const sendA = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenA(), method: 'POST', body: { path: '/send', to: '+573001110000', text: 'hola' } }))
      expect(sendA.status).toBe(403)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('UNLINKED verificado (orgLinked:false): /connect de A procede, pero send/conversations de B siguen DENIED', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL) => {
      const url = String(_url)
      if (url.endsWith('/status')) return new Response(JSON.stringify({ status: 'disconnected', orgLinked: false, linkedOrgId: null }), { status: 200 })
      return new Response(JSON.stringify({ status: 'connecting' }), { status: 200 })
    }))
    try {
      const connectA = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenA(), method: 'POST', body: { path: '/connect' } }))
      expect(connectA.status).toBe(200)
      const sendB = await daemonPost(req('/api/whatsapp/daemon-proxy', { token: tokenB(), method: 'POST', body: { path: '/send', to: '+573001110000', text: 'hola' } }))
      expect(sendB.status).toBe(403)
      const convsB = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/conversations', { token: tokenB() }))
      expect(convsB.status).toBe(403)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sesión vinculada a A: B tampoco obtiene /qr ni /status (sin fuga de teléfono/org)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL) => {
      const url = String(_url)
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ status: 'connected', phone: '+573009990000', linkedOrgId: 'org-a', orgLinked: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'waiting_qr', qr: 'data:image/png;base64,XXX' }), { status: 200 })
    }))
    try {
      const qrB = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/qr', { token: tokenB() }))
      expect(qrB.status).toBe(403)
      const statusB = await daemonGet(req('/api/whatsapp/daemon-proxy?path=/status', { token: tokenB() }))
      expect(statusB.status).toBe(403)
      const statusText = await statusB.text()
      expect(statusText).not.toContain('+573009990000')
      expect(statusText).not.toContain('org-a')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
