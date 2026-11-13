import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, auditAndTimeline } from '@/lib/api-helpers'
import {
  getIntegration,
  parseInstagramState,
  encodeInstagramState,
  metaGraphBase,
  META_GRAPH_VERSION,
} from '@/lib/integrations'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

/**
 * GET /api/instagram/oauth/callback — retorno de Meta tras autorizar.
 * 1. valida state CSRF (cookie vs query, tiempo constante, máx 10 min)
 * 2. code → token corto → token de larga duración (fb_exchange_token)
 * 3. /me/accounts → primera Página con Instagram Business vinculado
 * 4. guarda token de página cifrado (AES-256-GCM) + IG account id + activa canal
 * 5. best-effort: suscribe la cuenta IG a los webhooks de la app
 * Errores SIEMPRE redirigen a /settings?tab=instagram&ig_error=... (sin detalles internos).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const url = new URL(req.url)
    const fail = (code: string) => {
      const u = new URL('/settings?tab=instagram', req.url)
      u.searchParams.set('ig_error', code)
      return NextResponse.redirect(u)
    }

    const qState = url.searchParams.get('state') || ''
    const cState = req.cookies.get('ig_oauth_csrf')?.value || ''
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
    const ig = parseInstagramState(integration.instagramTokenEnc)
    const appId = (ig.metaAppId || '').trim()
    const appSecret = (ig.webhookSecret || decryptSecret(integration.metaAppSecretEnc) || '').trim()
    if (!appId || !appSecret) return fail('missing_app_credentials')

    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
      req.headers.get('host') ||
      url.host
    const origin = proto && host ? `${proto}://${host}` : url.origin
    const redirectUri = `${origin}/api/instagram/oauth/callback`

    const graph = metaGraphBase()
    const v = META_GRAPH_VERSION

    // 1) code → token de corta duración
    const tokUrl = new URL(`${graph}/${v}/oauth/access_token`)
    tokUrl.searchParams.set('client_id', appId)
    tokUrl.searchParams.set('client_secret', appSecret)
    tokUrl.searchParams.set('redirect_uri', redirectUri)
    tokUrl.searchParams.set('code', code)
    const tokRes = await fetch(tokUrl.toString(), { cache: 'no-store' })
    if (!tokRes.ok) return fail('token_exchange_failed')
    const tokJson = (await tokRes.json()) as { access_token?: string }
    const shortToken = tokJson.access_token
    if (!shortToken) return fail('token_exchange_failed')

    // 2) token corto → larga duración (~60 días; los tokens de página derivados no expiran con uso)
    const exUrl = new URL(`${graph}/${v}/oauth/access_token`)
    exUrl.searchParams.set('grant_type', 'fb_exchange_token')
    exUrl.searchParams.set('client_id', appId)
    exUrl.searchParams.set('client_secret', appSecret)
    exUrl.searchParams.set('fb_exchange_token', shortToken)
    const exRes = await fetch(exUrl.toString(), { cache: 'no-store' })
    if (!exRes.ok) return fail('long_lived_token_failed')
    const exJson = (await exRes.json()) as { access_token?: string }
    const longToken = exJson.access_token || shortToken

    // 3) páginas del usuario + IG Business vinculado
    const pagesUrl = new URL(`${graph}/${v}/me/accounts`)
    pagesUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username}')
    const pagesRes = await fetch(pagesUrl.toString(), {
      headers: { Authorization: `Bearer ${longToken}` },
      cache: 'no-store',
    })
    if (!pagesRes.ok) return fail('pages_fetch_failed')
    const pagesJson = (await pagesRes.json()) as {
      data?: Array<{
        id: string
        name?: string
        access_token: string
        instagram_business_account?: { id: string; username?: string }
      }>
    }
    const pages = pagesJson.data || []
    const hit = pages.find((p) => p.instagram_business_account?.id)
    if (!hit) return fail('no_ig_business_linked')

    const igAccount = hit.instagram_business_account!
    const pageToken = hit.access_token || longToken

    // 4) registrar la cuenta en el inventario canónico (shadow-write).
    // La clave está namespaced por proveedor/canal y nunca contiene credenciales.
    // Una cuenta Meta no puede quedar vinculada simultáneamente a dos tenants.
    const providerAccountKey = `meta:instagram:${igAccount.id}`
    const existingCanonical = await db.channelConnection.findUnique({
      where: { providerAccountKey },
      select: { id: true, organizationId: true },
    })
    if (existingCanonical && existingCanonical.organizationId !== auth.orgId) {
      return fail('instagram_account_in_use')
    }

    const next = encodeInstagramState({ ...ig, token: pageToken })
    const credentialsEnc = encryptSecret(JSON.stringify({
      accessToken: pageToken,
      appSecret,
      webhookVerifyToken: ig.webhookVerifyToken || null,
    }))
    if (!credentialsEnc) return fail('credential_encryption_failed')

    // La escritura canónica y el espejo legacy son atómicos. El webhook seguirá
    // leyendo Integration durante esta fase; el dual-read llegará tras paridad.
    await db.$transaction(async (tx) => {
      const connection = await tx.channelConnection.upsert({
        where: { providerAccountKey },
        create: {
          organizationId: auth.orgId,
          channel: 'instagram',
          provider: 'meta_graph',
          providerAccountKey,
          externalAccountId: igAccount.id,
          displayName: igAccount.username || hit.name || null,
          status: 'connected',
          credentialsEnc,
          metadata: JSON.stringify({ pageId: hit.id, pageName: hit.name || null, username: igAccount.username || null }),
          lastVerifiedAt: new Date(),
        },
        update: {
          displayName: igAccount.username || hit.name || null,
          status: 'connected',
          credentialsEnc,
          metadata: JSON.stringify({ pageId: hit.id, pageName: hit.name || null, username: igAccount.username || null }),
          lastVerifiedAt: new Date(),
          lastErrorAt: null,
          lastErrorCode: null,
        },
      })
      await tx.channelConnectionEvent.create({
        data: {
          organizationId: auth.orgId,
          connectionId: connection.id,
          type: 'connected',
          detail: 'instagram_oauth_connected',
        },
      })
      await tx.integration.update({
        where: { organizationId: auth.orgId },
        data: {
          instagramTokenEnc: next,
          instagramAccountId: igAccount.id,
          enableInstagram: true,
        },
      })
    })

    // 5) best-effort: suscribir la cuenta IG a los webhooks de la app
    try {
      await fetch(`${graph}/${v}/${encodeURIComponent(igAccount.id)}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribed_fields: 'messages,messaging_postbacks,message_reactions' }),
      })
    } catch {
      // no fatal: la suscripción también puede hacerse desde Meta Developers
    }

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: {
        provider: 'instagram',
        via: 'meta_oauth',
        igAccountId: igAccount.id,
        igUsername: igAccount.username || null,
        pageId: hit.id,
        tokenMasked: pageToken ? `${pageToken.slice(0, 4)}••••` : null,
      },
    })

    const ok = new URL('/settings?tab=instagram', req.url)
    ok.searchParams.set('ig_connected', igAccount.username || igAccount.id)
    const res = NextResponse.redirect(ok)
    res.cookies.delete('ig_oauth_csrf')
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
