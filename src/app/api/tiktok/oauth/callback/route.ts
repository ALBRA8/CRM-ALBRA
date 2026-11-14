import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, auditAndTimeline } from '@/lib/api-helpers'
import {
  getIntegration,
  parseTikTokState,
  encodeTikTokState,
  tiktokApiBase,
} from '@/lib/integrations'

/**
 * GET /api/tiktok/oauth/callback — retorno de TikTok tras autorizar (Login Kit v2).
 * 1. valida state CSRF (cookie vs query, tiempo constante, máx 10 min)
 * 2. code → access_token (POST form a /v2/oauth/token/) + refresh_token + open_id
 * 3. /v2/user/info/ → display_name
 * 4. guarda blob cifrado (AES-256-GCM) + activa canal
 * Errores SIEMPRE redirigen a /settings?tab=tiktok&tt_error=...
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const url = new URL(req.url)
    const fail = (code: string) => {
      const u = new URL('/settings?tab=tiktok', req.url)
      u.searchParams.set('tt_error', code)
      return NextResponse.redirect(u)
    }

    const qState = url.searchParams.get('state') || ''
    const cState = req.cookies.get('tt_oauth_csrf')?.value || ''
    const code = url.searchParams.get('code')
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error') || 'user_cancel')
    if (!code || !qState || !cState || !safeEqual(qState, cState)) return fail('csrf_invalid')

    const [orgId, nonce, exp, sig] = qState.split('.')
    if (!orgId || !nonce || !exp || !sig) return fail('csrf_invalid')
    if (orgId !== auth.orgId) return fail('csrf_invalid')
    if (Number(exp) < Date.now()) return fail('csrf_expired')
    const expected = crypto
      .createHmac('sha256', process.env.APP_SECRET as string)
      .update(`${orgId}.${nonce}.${exp}`)
      .digest('hex')
    if (!safeEqual(sig, expected)) return fail('csrf_invalid')

    const integration = await getIntegration(auth.orgId)
    const tt = parseTikTokState(integration.tiktokTokenEnc)
    const appKey = (tt.appKey || '').trim()
    const appSecret = (tt.appSecret || '').trim()
    if (!appKey || !appSecret) return fail('missing_app_key')

    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
      req.headers.get('host') ||
      url.host
    const origin = proto && host ? `${proto}://${host}` : url.origin
    const redirectUri = `${origin}/api/tiktok/oauth/callback`

    // code → token (TikTok exige form-encoded, no query string)
    const form = new URLSearchParams({
      client_key: appKey,
      client_secret: appSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    })
    const tokRes = await fetch(`${tiktokApiBase()}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      cache: 'no-store',
    })
    if (!tokRes.ok) return fail('token_exchange_failed')
    const tokJson = (await tokRes.json().catch(() => ({}))) as {
      access_token?: string
      refresh_token?: string
      open_id?: string
      scope?: string
      expires_in?: number
      refresh_expires_in?: number
    }
    if (
      !tokJson.access_token || !tokJson.refresh_token || !tokJson.open_id ||
      !Number.isFinite(tokJson.expires_in) || Number(tokJson.expires_in) <= 0 ||
      !Number.isFinite(tokJson.refresh_expires_in) || Number(tokJson.refresh_expires_in) <= 0
    ) return fail('token_exchange_failed')

    // perfil del usuario (user_info.basic)
    let displayName = ''
    try {
      const uiRes = await fetch(
        `${tiktokApiBase()}/v2/user/info/?fields=open_id,display_name`,
        { headers: { Authorization: `Bearer ${tokJson.access_token}` }, cache: 'no-store' },
      )
      if (uiRes.ok) {
        const ui = (await uiRes.json().catch(() => ({}))) as {
          data?: { user?: { display_name?: string } }
        }
        displayName = ui.data?.user?.display_name || ''
      }
    } catch {
      /* perfil no fatal */
    }

    const now = Date.now()
    const nextState = {
      ...tt,
      accessToken: tokJson.access_token,
      refreshToken: tokJson.refresh_token,
      accessTokenExpiresAt: now + Number(tokJson.expires_in) * 1000,
      refreshTokenExpiresAt: now + Number(tokJson.refresh_expires_in) * 1000,
      openId: tokJson.open_id,
      displayName,
      scope: tokJson.scope || undefined,
    }
    const next = encodeTikTokState(nextState)
    if (!next) return fail('token_persistence_failed')

    // Una autorización explícita de TikTok es el único camino que libera un
    // refreshState=uncertain. Se reemplaza el par completo de tokens y se
    // incrementa fencingVersion para invalidar cualquier worker anterior.
    const providerAccountKey = `tiktok:business:${tokJson.open_id}`
    const scopes = (tokJson.scope || '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
    const tokenExpiresAt = new Date(nextState.accessTokenExpiresAt)
    await db.$transaction(async (tx) => {
      const existing = await tx.channelConnection.findUnique({
        where: { providerAccountKey },
        select: { id: true, organizationId: true, channel: true, provider: true, externalAccountId: true },
      })
      if (existing && (
        existing.organizationId !== auth.orgId ||
        existing.channel !== 'tiktok' ||
        existing.provider !== 'tiktok_business' ||
        existing.externalAccountId !== tokJson.open_id
      )) {
        throw new Error('TIKTOK_ACCOUNT_OWNERSHIP_CONFLICT')
      }

      await tx.integration.update({
        where: { organizationId: auth.orgId },
        data: { tiktokTokenEnc: next, enableTikTok: true },
      })

      if (existing) {
        await tx.channelConnection.update({
          where: { id: existing.id },
          data: {
            externalAccountId: tokJson.open_id,
            displayName: displayName || null,
            status: 'connected',
            scopes: JSON.stringify(scopes),
            credentialsEnc: next,
            tokenExpiresAt,
            lastVerifiedAt: new Date(now),
            lastErrorAt: null,
            lastErrorCode: null,
            refreshState: 'idle',
            refreshLeaseToken: null,
            refreshLeaseExpiresAt: null,
            refreshFencingVersion: { increment: 1 },
          },
        })
        await tx.channelConnectionEvent.create({
          data: {
            organizationId: auth.orgId,
            connectionId: existing.id,
            type: 'connected',
            detail: 'via=login_kit_oauth; recovery=explicit_reauthorization',
          },
        })
      } else {
        const connection = await tx.channelConnection.create({
          data: {
            organizationId: auth.orgId,
            channel: 'tiktok',
            provider: 'tiktok_business',
            providerAccountKey,
            externalAccountId: tokJson.open_id,
            displayName: displayName || null,
            status: 'connected',
            scopes: JSON.stringify(scopes),
            credentialsEnc: next,
            tokenExpiresAt,
            lastVerifiedAt: new Date(now),
            refreshState: 'idle',
            refreshFencingVersion: 1,
          },
        })
        await tx.channelConnectionEvent.create({
          data: {
            organizationId: auth.orgId,
            connectionId: connection.id,
            type: 'connected',
            detail: 'via=login_kit_oauth',
          },
        })
      }
    })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: {
        provider: 'tiktok',
        via: 'login_kit_oauth',
        openId: tokJson.open_id,
        displayName: displayName || null,
        scope: tokJson.scope || null,
        tokenMasked: `${tokJson.access_token.slice(0, 4)}••••`,
      },
    })

    const ok = new URL('/settings?tab=tiktok', req.url)
    ok.searchParams.set('tt_connected', displayName || tokJson.open_id)
    const res = NextResponse.redirect(ok)
    res.cookies.delete('tt_oauth_csrf')
    return res
  })
}

/** Comparación en tiempo constante (evita oráculo de state). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}
