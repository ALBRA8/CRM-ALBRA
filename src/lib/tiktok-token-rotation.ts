import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { encodeTikTokState, parseTikTokState, refreshTikTokUserAccessToken } from '@/lib/integrations'

const REFRESH_SKEW_MS = 5 * 60 * 1000
const REFRESH_LEASE_MS = 30 * 1000

export type TikTokSendCredentialResult =
  | { ok: true; accessToken: string }
  | { ok: false; errorCode: string }

/**
 * Returns a usable TikTok access token. Refresh-token rotation is claimed with
 * a durable DB compare-and-swap. A crashed/expired lease is deliberately not
 * reclaimed: the provider may have rotated the refresh token before the crash.
 */
export async function prepareTikTokAccessTokenForSend(
  connectionId: string,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<TikTokSendCredentialResult> {
  const connection = await db.channelConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      channel: true,
      provider: true,
      status: true,
      credentialsEnc: true,
      refreshState: true,
      refreshFencingVersion: true,
    },
  })

  if (!connection || connection.channel !== 'tiktok' || connection.provider !== 'tiktok_business' || connection.status !== 'connected') {
    return { ok: false, errorCode: 'TIKTOK_CONNECTION_UNAVAILABLE' }
  }
  if (connection.refreshState !== 'idle') {
    return { ok: false, errorCode: connection.refreshState === 'uncertain' ? 'TIKTOK_REFRESH_UNCERTAIN' : 'TIKTOK_REFRESH_IN_PROGRESS' }
  }

  const state = parseTikTokState(connection.credentialsEnc)
  if (!state.accessToken) return { ok: false, errorCode: 'TIKTOK_CREDENTIALS_INVALID' }

  // Older/manual connections without expiry metadata retain their existing
  // access token. OAuth-created connections always persist expiry metadata.
  if (!Number.isFinite(state.accessTokenExpiresAt) || Number(state.accessTokenExpiresAt) > now + REFRESH_SKEW_MS) {
    return { ok: true, accessToken: state.accessToken }
  }

  const leaseToken = randomUUID()
  const fencingVersion = connection.refreshFencingVersion + 1
  const claimed = await db.channelConnection.updateMany({
    where: {
      id: connection.id,
      channel: 'tiktok',
      provider: 'tiktok_business',
      status: 'connected',
      refreshState: 'idle',
      refreshFencingVersion: connection.refreshFencingVersion,
    },
    data: {
      refreshState: 'refreshing',
      refreshLeaseToken: leaseToken,
      refreshLeaseExpiresAt: new Date(now + REFRESH_LEASE_MS),
      refreshFencingVersion: { increment: 1 },
    },
  })
  if (claimed.count !== 1) return { ok: false, errorCode: 'TIKTOK_REFRESH_CLAIM_LOST' }

  const rotated = await refreshTikTokUserAccessToken({ state, fetchImpl, now })
  if (!rotated.ok) {
    const invalidGrant = rotated.error === 'TIKTOK_REFRESH_INVALID_GRANT'
    await db.channelConnection.updateMany({
      where: {
        id: connection.id,
        status: 'connected',
        refreshState: 'refreshing',
        refreshLeaseToken: leaseToken,
        refreshFencingVersion: fencingVersion,
      },
      data: {
        status: invalidGrant ? 'reconnect_required' : 'connected',
        refreshState: 'uncertain',
        refreshLeaseToken: null,
        refreshLeaseExpiresAt: null,
        lastErrorAt: new Date(now),
        lastErrorCode: invalidGrant ? 'TIKTOK_REFRESH_INVALID_GRANT' : 'TIKTOK_REFRESH_UNCERTAIN',
      },
    })
    return {
      ok: false,
      errorCode: invalidGrant ? 'TIKTOK_RECONNECT_REQUIRED' : 'TIKTOK_REFRESH_UNCERTAIN',
    }
  }

  const encrypted = encryptSecret(JSON.stringify(rotated.state))
  if (!encrypted) {
    await db.channelConnection.updateMany({
      where: { id: connection.id, refreshState: 'refreshing', refreshLeaseToken: leaseToken, refreshFencingVersion: fencingVersion },
      data: {
        refreshState: 'uncertain',
        refreshLeaseToken: null,
        refreshLeaseExpiresAt: null,
        lastErrorAt: new Date(now),
        lastErrorCode: 'TIKTOK_REFRESH_PERSIST_FAILED',
      },
    })
    return { ok: false, errorCode: 'TIKTOK_REFRESH_PERSIST_FAILED' }
  }

  const persisted = await db.channelConnection.updateMany({
    where: {
      id: connection.id,
      status: 'connected',
      refreshState: 'refreshing',
      refreshLeaseToken: leaseToken,
      refreshFencingVersion: fencingVersion,
    },
    data: {
      credentialsEnc: encrypted,
      tokenExpiresAt: rotated.state.accessTokenExpiresAt ? new Date(rotated.state.accessTokenExpiresAt) : null,
      refreshState: 'idle',
      refreshLeaseToken: null,
      refreshLeaseExpiresAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      lastVerifiedAt: new Date(now),
    },
  })
  if (persisted.count !== 1) {
    // Never send using an in-memory token if durable CAS persistence failed.
    return { ok: false, errorCode: 'TIKTOK_REFRESH_PERSIST_CONFLICT' }
  }

  return { ok: true, accessToken: rotated.state.accessToken! }
}
