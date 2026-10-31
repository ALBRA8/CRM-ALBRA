import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireAdmin } from '@/lib/auth'
import { handle } from '@/lib/api-helpers'
import {
  getIntegration,
  parseInstagramState,
  metaDialogBase,
  META_GRAPH_VERSION,
} from '@/lib/integrations'
import { decryptSecret } from '@/lib/crypto'

/**
 * GET /api/instagram/oauth/start — "Conectar mediante Meta" (flujo ManyChat).
 * Firma el state CSRF (HMAC-SHA256 con APP_SECRET), lo deja en cookie httpOnly
 * y redirige al diálogo OAuth de Meta. El App Secret jamás viaja al navegador.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const ig = parseInstagramState(integration.instagramTokenEnc)

    const appId = (ig.metaAppId || '').trim()
    const appSecret = (ig.webhookSecret || decryptSecret(integration.metaAppSecretEnc) || '').trim()

    const settingsUrl = new URL('/settings?tab=instagram', req.url)
    if (!appId || !appSecret) {
      settingsUrl.searchParams.set('ig_error', 'missing_app_credentials')
      return NextResponse.redirect(settingsUrl)
    }

    // redirect_uri EXACTO: debe estar registrado en Meta App → Valid OAuth Redirect URIs
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
      req.headers.get('host') ||
      new URL(req.url).host
    const origin = proto && host ? `${proto}://${host}` : new URL(req.url).origin
    const redirectUri = `${origin}/api/instagram/oauth/callback`

    // state anti-CSRF firmado: orgId.nonce.exp.hmac
    const nonce = crypto.randomBytes(16).toString('hex')
    const exp = Date.now() + 10 * 60 * 1000
    const payload = `${auth.orgId}.${nonce}.${exp}`
    const sig = crypto
      .createHmac('sha256', process.env.APP_SECRET as string)
      .update(payload)
      .digest('hex')
    const state = `${payload}.${sig}`

    const scope = [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
      'pages_show_list',
      'pages_manage_metadata',
      'business_management',
    ].join(',')

    const dialog = new URL(`${metaDialogBase()}/${META_GRAPH_VERSION}/dialog/oauth`)
    dialog.searchParams.set('client_id', appId)
    dialog.searchParams.set('redirect_uri', redirectUri)
    dialog.searchParams.set('state', state)
    dialog.searchParams.set('response_type', 'code')
    dialog.searchParams.set('scope', scope)

    const res = NextResponse.redirect(dialog.toString())
    res.cookies.set('ig_oauth_csrf', state, {
      httpOnly: true,
      sameSite: 'lax', // navegación superior de vuelta desde Meta: la cookie SÍ viaja
      secure: proto === 'https',
      path: '/api/instagram/oauth',
      maxAge: 600,
    })
    return res
  })
}
