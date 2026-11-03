import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import {
  getIntegration,
  parseInstagramState,
  metaDialogBase,
  META_GRAPH_VERSION,
} from '@/lib/integrations'
import { decryptSecret } from '@/lib/crypto'

/**
 * GET|POST /api/facebook/oauth/start — "Conectar mediante Meta" (Messenger de la
 * Página, flujo ManyChat). Misma app de Meta que Instagram: el App ID vive en el
 * blob cifrado de Instagram (instagramTokenEnc → metaAppId) y el App Secret en
 * instagramTokenEnc.webhookSecret o metaAppSecretEnc.
 *
 *  - state CSRF firmado: orgId.nonce.exp.HMAC-SHA256(APP_SECRET), exp 10 min,
 *    cookie httpOnly `facebook_oauth_csrf` (600s, path del callback, timing-safe
 *    en el callback).
 *  - redirect_uri derivado de x-forwarded-proto/host (tras el gateway del preview
 *    url.origin miente; Meta exige coincidencia EXACTA con la URI registrada).
 *  - Modo navegador (Accept: text/html o ?redirect=1) → 302 al diálogo de Meta.
 *    Modo JSON (cliente API) → { url, redirectUri, appId, scope } SIN redirect.
 * Errores: missing_app_credentials (redirect ?facebook_error= o JSON 400).
 */

async function startHandler(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const url = new URL(req.url)

    // Credenciales de la app de Meta COMPARTIDAS con Instagram (misma Integration)
    const integration = await getIntegration(auth.orgId)
    const ig = parseInstagramState(integration.instagramTokenEnc)
    const appId = (ig.metaAppId || '').trim()
    const appSecret = (ig.webhookSecret || decryptSecret(integration.metaAppSecretEnc) || '').trim()

    const browserMode =
      (req.headers.get('accept') || '').includes('text/html') || url.searchParams.get('redirect') === '1'

    if (!appId || !appSecret) {
      if (browserMode) {
        const settingsUrl = new URL('/settings?tab=facebook', req.url)
        settingsUrl.searchParams.set('facebook_error', 'missing_app_credentials')
        return NextResponse.redirect(settingsUrl)
      }
      return json(
        {
          error:
            'Messenger OAuth no configurado. Guarda primero el App ID y el App Secret de tu app de Meta (la misma de Instagram).',
          code: 'missing_app_credentials',
        },
        { status: 400 }
      )
    }

    // redirect_uri EXACTO: debe estar registrado en Meta App → Valid OAuth Redirect URIs
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
      req.headers.get('host') ||
      url.host
    const origin = proto && host ? `${proto}://${host}` : url.origin
    const redirectUri = `${origin}/api/facebook/oauth/callback`

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
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_metadata',
      'pages_messaging',
    ].join(',')

    const dialog = new URL(`${metaDialogBase()}/${META_GRAPH_VERSION}/dialog/oauth`)
    dialog.searchParams.set('client_id', appId)
    dialog.searchParams.set('redirect_uri', redirectUri)
    dialog.searchParams.set('state', state)
    dialog.searchParams.set('response_type', 'code')
    dialog.searchParams.set('scope', scope)

    // Cliente API (JSON): misma conducta que Google, { url, redirectUri } sin redirect
    if (!browserMode) {
      return json({ url: dialog.toString(), redirectUri, appId, scope })
    }

    const res = NextResponse.redirect(dialog.toString())
    res.cookies.set('facebook_oauth_csrf', state, {
      httpOnly: true,
      sameSite: 'lax', // navegación superior de vuelta desde Meta: la cookie SÍ viaja
      secure: proto === 'https',
      path: '/api/facebook/oauth/callback',
      maxAge: 600,
    })
    return res
  })
}

export async function GET(req: NextRequest) {
  return startHandler(req)
}

export async function POST(req: NextRequest) {
  return startHandler(req)
}
