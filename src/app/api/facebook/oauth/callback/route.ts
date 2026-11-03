import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handle, auditAndTimeline } from '@/lib/api-helpers'
import {
  getIntegration,
  parseInstagramState,
  parseFacebookState,
  encodeFacebookState,
  safeEquals,
  metaGraphBase,
  META_GRAPH_VERSION,
} from '@/lib/integrations'
import { decryptSecret } from '@/lib/crypto'

/**
 * GET /api/facebook/oauth/callback — retorno de Meta tras autorizar (Messenger).
 * 1. valida state CSRF (cookie vs query, tiempo constante, org, exp ≤ 10 min, HMAC)
 * 2. code → user access token ({metaGraphBase}/v21.0/oauth/access_token)
 * 3. /me (best-effort, email de la cuenta que autorizó) + /me/accounts → primera
 *    Página (si hay varias se guarda la primera y el resto queda para un futuro
 *    selector multi-página)
 * 4. guarda blob cifrado AES-256-GCM (pageToken + pageId + pageName + userEmail +
 *    verifyToken existente) + columnas facebookPageId/PageName/UserEmail + canal ACTIVO
 * 5. best-effort: suscribe la Página a los webhooks (messaging, messaging_postbacks);
 *    si falla NO rompe la conexión → facebook_warning=subscribe_failed en la query
 * Errores SIEMPRE redirigen a /settings?tab=facebook&facebook_error=<código>
 * (sin detalles internos). Alimenta EXACTAMENTE las estructuras que consumen
 * /api/facebook/webhook y /api/facebook/send (sin cambios en ellas).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const url = new URL(req.url)
    const fail = (code: string) => {
      const u = new URL('/settings?tab=facebook', req.url)
      u.searchParams.set('facebook_error', code)
      return NextResponse.redirect(u)
    }

    // Meta cancela la autorización con error=access_denied → user_cancel
    const qpError = url.searchParams.get('error')
    if (qpError) return fail(qpError === 'access_denied' ? 'user_cancel' : qpError)

    const qState = url.searchParams.get('state') || ''
    const cState = req.cookies.get('facebook_oauth_csrf')?.value || ''
    const code = url.searchParams.get('code')
    if (!code || !qState || !cState || !safeEquals(qState, cState)) return fail('csrf_invalid')

    const [orgId, nonce, exp, sig] = qState.split('.')
    if (!orgId || !nonce || !exp || !sig) return fail('csrf_invalid')
    if (orgId !== auth.orgId) return fail('csrf_invalid')
    if (Number(exp) < Date.now()) return fail('csrf_expired')
    const expected = crypto
      .createHmac('sha256', process.env.APP_SECRET as string)
      .update(`${orgId}.${nonce}.${exp}`)
      .digest('hex')
    if (!safeEquals(sig, expected)) return fail('csrf_invalid')

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
    const redirectUri = `${origin}/api/facebook/oauth/callback`

    const graph = metaGraphBase()
    const v = META_GRAPH_VERSION

    // 1) code → user access token (Meta: { access_token, token_type })
    const tokUrl = new URL(`${graph}/${v}/oauth/access_token`)
    tokUrl.searchParams.set('client_id', appId)
    tokUrl.searchParams.set('redirect_uri', redirectUri)
    tokUrl.searchParams.set('client_secret', appSecret)
    tokUrl.searchParams.set('code', code)
    const tokRes = await fetch(tokUrl.toString(), { cache: 'no-store' })
    if (!tokRes.ok) return fail('token_endpoint_reject')
    const tokJson = (await tokRes.json().catch(() => ({}))) as { access_token?: string; token_type?: string }
    const userToken = tokJson.access_token
    if (!userToken) return fail('token_endpoint_reject')

    // 2) perfil de quien autorizó (email para auditoría) — best-effort, no fatal
    let userEmail = ''
    try {
      const meRes = await fetch(`${graph}/${v}/me?fields=id,name,email&access_token=${encodeURIComponent(userToken)}`, {
        cache: 'no-store',
      })
      if (meRes.ok) {
        const me = (await meRes.json().catch(() => ({}))) as { email?: string; name?: string }
        userEmail = (me.email || '').trim()
      }
    } catch {
      /* email no fatal */
    }

    // 3) páginas del usuario → primera Página (futuras: selector multi-página)
    const pagesUrl = new URL(`${graph}/${v}/me/accounts`)
    pagesUrl.searchParams.set('fields', 'id,name,access_token')
    pagesUrl.searchParams.set('access_token', userToken)
    const pagesRes = await fetch(pagesUrl.toString(), { cache: 'no-store' })
    if (!pagesRes.ok) return fail('no_pages')
    const pagesJson = (await pagesRes.json().catch(() => ({}))) as {
      data?: Array<{ id: string; name?: string; access_token?: string }>
    }
    const pages = pagesJson.data || []
    const hit = pages[0]
    if (!hit || !hit.id) return fail('no_pages')
    const pageToken = hit.access_token || userToken

    // 4) guardar cifrado (conserva el webhookVerifyToken existente) y activar canal
    const fb = parseFacebookState(integration.facebookTokenEnc)
    const next = encodeFacebookState({
      ...fb,
      pageToken,
      pageId: hit.id,
      pageName: hit.name || undefined,
      userEmail: userEmail || undefined,
    })
    await db.integration.update({
      where: { organizationId: auth.orgId },
      data: {
        facebookTokenEnc: next,
        facebookPageId: hit.id,
        facebookPageName: hit.name || null,
        facebookUserEmail: userEmail || null,
        enableFacebook: true,
      },
    })

    // 5) best-effort: suscribir la Página a los webhooks de la app. No fatal:
    //    la conexión queda guardada y el fallo viaja como warning en la query.
    let subscribeWarn = false
    try {
      const subRes = await fetch(
        `${graph}/${v}/${encodeURIComponent(hit.id)}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscribed_fields: 'messaging,messaging_postbacks' }),
          cache: 'no-store',
        }
      )
      if (!subRes.ok) subscribeWarn = true
    } catch {
      subscribeWarn = true
    }

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: {
        provider: 'facebook',
        via: 'meta_oauth',
        pageId: hit.id,
        pageName: hit.name || null,
        userEmail: userEmail || null,
        pagesAvailable: pages.length,
        tokenMasked: pageToken ? `${pageToken.slice(0, 4)}••••` : null,
      },
    })

    const ok = new URL('/settings?tab=facebook', req.url)
    ok.searchParams.set('facebook_connected', hit.name || hit.id)
    if (subscribeWarn) ok.searchParams.set('facebook_warning', 'subscribe_failed')
    const res = NextResponse.redirect(ok)
    res.cookies.delete('facebook_oauth_csrf')
    return res
  })
}
