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
    const eligiblePages = pages.filter((page) => page.instagram_business_account?.id && page.access_token)
    if (!eligiblePages.length) return fail('no_ig_business_linked')

    // Una sola autorización Meta puede devolver varias páginas con Instagram.
    // Registrar todas evita perder las cuentas secundarias; la primera sigue
    // siendo la seleccionada en Integration hasta que la UI permita elegir.
    const accountKeys = eligiblePages.map((page) => `meta:instagram:${page.instagram_business_account!.id}`)
    const existingConnections = await db.channelConnection.findMany({
      where: { providerAccountKey: { in: accountKeys } },
      select: { providerAccountKey: true, organizationId: true },
    })
    if (existingConnections.some((connection) => connection.organizationId !== auth.orgId)) {
      return fail('instagram_account_in_use')
    }

    const selectedPage = eligiblePages[0]
    const selectedAccount = selectedPage.instagram_business_account!
    const selectedToken = selectedPage.access_token || longToken
    const next = encodeInstagramState({ ...ig, token: selectedToken })

    const prepared = eligiblePages.map((page) => {
      const account = page.instagram_business_account!
      const pageToken = page.access_token || longToken
      const credentialsEnc = encryptSecret(JSON.stringify({
        accessToken: pageToken,
        appSecret,
        webhookVerifyToken: ig.webhookVerifyToken || null,
      }))
      return { page, account, pageToken, credentialsEnc }
    })
    if (prepared.some((item) => !item.credentialsEnc)) return fail('credential_encryption_failed')

    // Todas las cuentas se registran atómicamente. Integration conserva solo
    // la primera por compatibilidad hasta completar selector y dual-read.
    await db.$transaction(async (tx) => {
      for (const item of prepared) {
        const providerAccountKey = `meta:instagram:${item.account.id}`
        // No usar upsert global por providerAccountKey: el chequeo previo de
        // ownership puede quedar obsoleto antes de esta transacción. Un upsert
        // podría actualizar credenciales de una cuenta que otro tenant acaba
        // de reclamar. Actualizar solo una fila ya scoped; si la clave global
        // aparece en otro tenant, el create colisiona y aborta la transacción.
        const existingForTenant = await tx.channelConnection.findFirst({
          where: { providerAccountKey, organizationId: auth.orgId, channel: 'instagram', provider: 'meta_graph' },
          select: { id: true },
        })
        const connectionData = {
          displayName: item.account.username || item.page.name || null,
          status: 'connected',
          credentialsEnc: item.credentialsEnc!,
          metadata: JSON.stringify({ pageId: item.page.id, pageName: item.page.name || null, username: item.account.username || null }),
          lastVerifiedAt: new Date(),
          lastErrorAt: null,
          lastErrorCode: null,
        }
        const connection = existingForTenant
          ? await tx.channelConnection.update({ where: { id: existingForTenant.id }, data: connectionData })
          : await tx.channelConnection.create({
              data: {
                organizationId: auth.orgId,
                channel: 'instagram',
                provider: 'meta_graph',
                providerAccountKey,
                externalAccountId: item.account.id,
                ...connectionData,
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
      }
      await tx.integration.update({
        where: { organizationId: auth.orgId },
        data: {
          instagramTokenEnc: next,
          instagramAccountId: selectedAccount.id,
          enableInstagram: true,
        },
      })
    })

    // 5) best-effort: suscribir todas las cuentas registradas.
    for (const item of prepared) {
      try {
        await fetch(`${graph}/${v}/${encodeURIComponent(item.account.id)}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${item.pageToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscribed_fields: 'messages,messaging_postbacks,message_reactions' }),
        })
      } catch {
        // no fatal: la suscripción también puede hacerse desde Meta Developers
      }
    }

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: {
        provider: 'instagram',
        via: 'meta_oauth',
        igAccountIds: prepared.map((item) => item.account.id),
        selectedIgAccountId: selectedAccount.id,
        pageCount: prepared.length,
      },
    })

    const ok = new URL('/settings?tab=instagram', req.url)
    ok.searchParams.set('ig_connected', selectedAccount.username || selectedAccount.id)
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
