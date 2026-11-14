import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { encodeTikTokState, parseTikTokState } from '@/lib/integrations'
import { FIX } from '../setup/seed-data'

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(async () => ({ orgId: 'org-a', userId: 'user-a' })),
}))
vi.mock('@/lib/api-helpers', () => ({
  handle: async (fn: () => Promise<unknown>) => fn(),
  auditAndTimeline: vi.fn(async () => undefined),
}))

import { GET as tiktokOAuthCallback } from '@/app/api/tiktok/oauth/callback/route'

const openId = 'synthetic-reconnect-open-id'
const providerAccountKey = `tiktok:business:${openId}`
const connectionIds: string[] = []
const previousAppSecret = process.env.APP_SECRET

afterEach(async () => {
  vi.unstubAllGlobals()
  if (previousAppSecret === undefined) delete process.env.APP_SECRET
  else process.env.APP_SECRET = previousAppSecret
  await db.channelConnectionEvent.deleteMany({ where: { connectionId: { in: connectionIds } } })
  if (connectionIds.length) {
    await db.channelConnection.deleteMany({ where: { id: { in: connectionIds } } })
    connectionIds.length = 0
  }
  await db.integration.deleteMany({ where: { organizationId: FIX.orgA.id } })
})

function callbackRequest() {
  const secret = 'synthetic-callback-hmac-secret-for-tests'
  process.env.APP_SECRET = secret
  const nonce = 'synthetic-csrf-nonce'
  const expires = String(Date.now() + 5 * 60_000)
  const payload = `${FIX.orgA.id}.${nonce}.${expires}`
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const state = `${payload}.${signature}`
  const url = new URL('https://crm.test/api/tiktok/oauth/callback')
  url.searchParams.set('code', 'synthetic-oauth-code')
  url.searchParams.set('state', state)
  return new NextRequest(url, { headers: { cookie: `tt_oauth_csrf=${state}`, host: 'crm.test' } })
}

function mockTikTokExchange() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const target = String(input)
    if (target.includes('/v2/oauth/token/')) {
      return new Response(JSON.stringify({
        access_token: 'synthetic-new-access-token',
        refresh_token: 'synthetic-new-refresh-token',
        open_id: openId,
        expires_in: 7200,
        refresh_expires_in: 15_552_000,
        scope: 'user.info.basic,business.messaging',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ data: { user: { display_name: 'Synthetic Business' } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
}

describe('TikTok OAuth reconnection persistence', () => {
  it('replaces uncertain credentials atomically and fences stale refresh workers', async () => {
    const existingIntegration = await db.integration.create({
      data: {
        organizationId: FIX.orgA.id,
        tiktokTokenEnc: encodeTikTokState({
          appKey: 'synthetic-client-key',
          appSecret: 'synthetic-client-secret',
          accessToken: 'synthetic-old-access-token',
          refreshToken: 'synthetic-old-refresh-token',
        }),
        enableTikTok: false,
      },
    })
    const connection = await db.channelConnection.create({
      data: {
        organizationId: FIX.orgA.id,
        channel: 'tiktok',
        provider: 'tiktok_business',
        providerAccountKey,
        externalAccountId: openId,
        credentialsEnc: encryptSecret(JSON.stringify({ accessToken: 'synthetic-quarantined-token' }))!,
        status: 'reconnect_required',
        refreshState: 'uncertain',
        refreshLeaseToken: 'synthetic-stale-lease',
        refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
        refreshFencingVersion: 4,
      },
    })
    connectionIds.push(connection.id)
    mockTikTokExchange()

    const response = await tiktokOAuthCallback(callbackRequest())
    const [storedIntegration, storedConnection, events] = await Promise.all([
      db.integration.findUnique({ where: { organizationId: FIX.orgA.id } }),
      db.channelConnection.findUnique({ where: { id: connection.id } }),
      db.channelConnectionEvent.findMany({ where: { connectionId: connection.id } }),
    ])
    const state = parseTikTokState(storedConnection?.credentialsEnc)

    expect(response.status).toBe(307)
    expect(existingIntegration.enableTikTok).toBe(false)
    expect(storedIntegration?.enableTikTok).toBe(true)
    expect(state).toMatchObject({
      accessToken: 'synthetic-new-access-token',
      refreshToken: 'synthetic-new-refresh-token',
      openId,
      displayName: 'Synthetic Business',
      scope: 'user.info.basic,business.messaging',
    })
    expect(state.accessTokenExpiresAt).toBeGreaterThan(Date.now())
    expect(state.refreshTokenExpiresAt).toBeGreaterThan(state.accessTokenExpiresAt!)
    expect(storedConnection).toMatchObject({
      status: 'connected',
      refreshState: 'idle',
      refreshLeaseToken: null,
      refreshLeaseExpiresAt: null,
      refreshFencingVersion: 5,
      scopes: JSON.stringify(['user.info.basic', 'business.messaging']),
    })
    expect(storedConnection?.tokenExpiresAt?.getTime()).toBe(state.accessTokenExpiresAt)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('connected')
  })

  it('does not accept a token response without both expiry values', async () => {
    await db.integration.create({
      data: {
        organizationId: FIX.orgA.id,
        tiktokTokenEnc: encodeTikTokState({
          appKey: 'synthetic-client-key',
          appSecret: 'synthetic-client-secret',
        }),
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      open_id: openId,
      expires_in: 7200,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const response = await tiktokOAuthCallback(callbackRequest())
    const connection = await db.channelConnection.findUnique({ where: { providerAccountKey } })
    const integration = await db.integration.findUnique({ where: { organizationId: FIX.orgA.id } })

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).searchParams.get('tt_error')).toBe('token_exchange_failed')
    expect(connection).toBeNull()
    expect(parseTikTokState(integration?.tiktokTokenEnc).accessToken).toBeUndefined()
  })
})
