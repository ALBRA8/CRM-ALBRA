import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { GET as oauthCallback } from '@/app/api/instagram/oauth/callback/route'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { encodeInstagramState } from '@/lib/integrations'
import { FIX, req, tokenA } from '../helpers'

const accountId = '17840000000999123'
const providerAccountKey = `meta:instagram:${accountId}`
let createdConnectionId: string | null = null
let originalIntegration: { instagramTokenEnc: string | null; metaAppSecretEnc: string | null } | null = null
let createdIntegration = false

afterEach(async () => {
  if (createdConnectionId) {
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: createdConnectionId } })
    await db.channelConnection.deleteMany({ where: { id: createdConnectionId } })
    createdConnectionId = null
  }
  if (createdIntegration) {
    await db.integration.deleteMany({ where: { organizationId: FIX.orgA.id } })
    createdIntegration = false
  } else if (originalIntegration) {
    await db.integration.update({
      where: { organizationId: FIX.orgA.id },
      data: originalIntegration,
    })
  }
  originalIntegration = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Instagram OAuth callback tenant ownership', () => {
  it('never overwrites another organization credentials for a globally unique account key', async () => {
    const existingIntegration = await db.integration.findUnique({ where: { organizationId: FIX.orgA.id } })
    if (existingIntegration) {
      originalIntegration = {
        instagramTokenEnc: existingIntegration.instagramTokenEnc,
        metaAppSecretEnc: existingIntegration.metaAppSecretEnc,
      }
    } else {
      await db.integration.create({ data: { organizationId: FIX.orgA.id } })
      createdIntegration = true
    }
    const appSecret = ['instagram', 'oauth', 'isolation', 'secret', 'fixture'].join('-')
    await db.integration.update({
      where: { organizationId: FIX.orgA.id },
      data: {
        instagramTokenEnc: encodeInstagramState({ metaAppId: 'fixture-app-id', webhookSecret: appSecret }),
        metaAppSecretEnc: null,
      },
    })

    const foreignCredentials = encryptSecret(JSON.stringify({
      accessToken: ['foreign', 'tenant', 'token', 'must', 'remain', 'unchanged'].join('-'),
      appSecret: ['foreign', 'app', 'secret'].join('-'),
      webhookVerifyToken: ['foreign', 'verify', 'token'].join('-'),
    }))!
    let foreign: { id: string; organizationId: string; credentialsEnc: string } | null = null
    const originalFindMany = db.channelConnection.findMany.bind(db.channelConnection)
    vi.spyOn(db.channelConnection, 'findMany').mockImplementation(async (...args) => {
      // Simula otra organización reclamando la cuenta justo después del
      // pre-chequeo de ownership y antes de la transacción de persistencia.
      const rows = await originalFindMany(...args)
      if (!foreign) {
        foreign = await db.channelConnection.create({
          data: {
            organizationId: FIX.orgB.id,
            channel: 'instagram',
            provider: 'meta_graph',
            providerAccountKey,
            externalAccountId: accountId,
            credentialsEnc: foreignCredentials,
            status: 'connected',
          },
          select: { id: true, organizationId: true, credentialsEnc: true },
        })
        createdConnectionId = foreign.id
      }
      return rows
    })

    const originalFetch = global.fetch
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'short-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: 'facebook-page-fixture',
          name: 'Página fixture',
          access_token: ['page', 'token', 'fixture'].join('-'),
          instagram_business_account: { id: accountId, username: 'fixture_account' },
        }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const exp = Date.now() + 5 * 60_000
    const nonce = 'oauth-tenant-isolation-nonce'
    const payload = `${FIX.orgA.id}.${nonce}.${exp}`
    const sig = createHmac('sha256', process.env.APP_SECRET!).update(payload).digest('hex')
    const state = `${payload}.${sig}`
    const response = await oauthCallback(req(
      `/api/instagram/oauth/callback?code=fixture-code&state=${encodeURIComponent(state)}`,
      { token: tokenA(), cookie: `ig_oauth_csrf=${encodeURIComponent(state)}` },
    ))

    expect(response.status).toBe(500)
    expect(foreign).not.toBeNull()
    const unchanged = await db.channelConnection.findUniqueOrThrow({ where: { id: foreign!.id } })
    expect(unchanged.organizationId).toBe(FIX.orgB.id)
    expect(unchanged.credentialsEnc).toBe(foreignCredentials)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.stubGlobal('fetch', originalFetch)
  })
})
