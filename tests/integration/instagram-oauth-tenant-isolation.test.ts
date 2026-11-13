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

afterEach(async () => {
  if (createdConnectionId) {
    await db.channelConnectionEvent.deleteMany({ where: { connectionId: createdConnectionId } })
    await db.channelConnection.deleteMany({ where: { id: createdConnectionId } })
    createdConnectionId = null
  }
  if (originalIntegration) {
    await db.integration.update({
      where: { organizationId: FIX.orgA.id },
      data: originalIntegration,
    })
    originalIntegration = null
  }
  vi.unstubAllGlobals()
})

describe('Instagram OAuth callback tenant ownership', () => {
  it('never overwrites another organization credentials for a globally unique account key', async () => {
    const integration = await db.integration.findUniqueOrThrow({ where: { organizationId: FIX.orgA.id } })
    originalIntegration = {
      instagramTokenEnc: integration.instagramTokenEnc,
      metaAppSecretEnc: integration.metaAppSecretEnc,
    }
    const appSecret = 'instagram-oauth-isolation-secret-fixture'
    await db.integration.update({
      where: { organizationId: FIX.orgA.id },
      data: {
        instagramTokenEnc: encodeInstagramState({ metaAppId: 'fixture-app-id', webhookSecret: appSecret }),
        metaAppSecretEnc: null,
      },
    })

    const foreignCredentials = encryptSecret(JSON.stringify({
      accessToken: 'foreign-tenant-token-must-remain-unchanged',
      appSecret: 'foreign-app-secret',
      webhookVerifyToken: 'foreign-verify-token',
    }))!
    const foreign = await db.channelConnection.create({
      data: {
        organizationId: FIX.orgB.id,
        channel: 'instagram',
        provider: 'meta_graph',
        providerAccountKey,
        externalAccountId: accountId,
        credentialsEnc: foreignCredentials,
        status: 'connected',
      },
    })
    createdConnectionId = foreign.id

    const originalFetch = global.fetch
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'short-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: 'facebook-page-fixture',
          name: 'Página fixture',
          access_token: 'page-token-fixture',
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

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('ig_error=instagram_account_in_use')
    const unchanged = await db.channelConnection.findUniqueOrThrow({ where: { id: foreign.id } })
    expect(unchanged.organizationId).toBe(FIX.orgB.id)
    expect(unchanged.credentialsEnc).toBe(foreignCredentials)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.stubGlobal('fetch', originalFetch)
  })
})
