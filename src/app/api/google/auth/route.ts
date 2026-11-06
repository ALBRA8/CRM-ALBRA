import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requirePermission } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { getGoogleClientConfig, buildOAuthUrl, exchangeCodeForTokens } from '@/lib/google'

/**
 * GET /api/google/auth — botón "Conectar con Google" (flujo GitHub/ManyChat).
 * requirePermission 'integrations.*' (admin-only): iniciar el OAuth de la
 * organización es una operación de integración, no operativa.
 *
 * Inicio (sin ?code=):
 *  - state CSRF firmado (orgId.nonce.exp.HMAC-SHA256 con APP_SECRET) + cookie
 *    httpOnly `google_oauth_csrf` (600s, path=/api/google/auth, timing-safe).
 *  - redirect_uri derivado de x-forwarded-proto/host: tras el gateway del
 *    preview url.origin miente (http) y Google exige coincidencia EXACTA con
 *    la URI registrada en Google Cloud.
 *  - Navegador (Accept: text/html o ?redirect=1) → 302 al diálogo de Google.
 *    Cliente API (JSON) → { url, redirectUri }.
 *
 * Callback (con ?code=):
 *  1. valida state (cookie vs query, org, exp ≤ 10 min, firma) — cualquier
 *     fallo redirige a /settings?tab=google&google_error=<código> SIN detalles
 *     internos.
 *  2. code → tokens (refresh persistido cifrado) + userinfo → email de la
 *     cuenta conectada.
 *  3. redirect /settings?tab=google&google_connected=<email|1>.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requirePermission(req, 'integrations.*')
    const url = new URL(req.url)

    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
      req.headers.get('host') ||
      url.host
    const origin = proto && host ? `${proto}://${host}` : url.origin
    const redirectUri = `${origin}/api/google/auth`

    const settingsUrl = new URL('/settings?tab=google', origin)
    const fail = (code: string) => {
      settingsUrl.searchParams.set('google_error', code)
      return NextResponse.redirect(settingsUrl.toString())
    }

    // ---------- Callback de Google ----------
    const code = url.searchParams.get('code')
    if (code) {
      if (url.searchParams.get('error')) {
        return fail(url.searchParams.get('error') === 'access_denied' ? 'user_cancel' : 'provider_error')
      }
      const qState = url.searchParams.get('state') || ''
      const cState = req.cookies.get('google_oauth_csrf')?.value || ''
      if (!qState || !cState || !safeEqual(qState, cState)) return fail('csrf_invalid')

      const [orgId, nonce, exp, sig] = qState.split('.')
      if (!orgId || !nonce || !exp || !sig) return fail('csrf_invalid')
      if (orgId !== auth.orgId) return fail('csrf_invalid')
      if (Number(exp) < Date.now()) return fail('csrf_expired')
      const expected = crypto
        .createHmac('sha256', process.env.APP_SECRET as string)
        .update(`${orgId}.${nonce}.${exp}`)
        .digest('hex')
      if (!safeEqual(sig, expected)) return fail('csrf_invalid')

      const client = await getGoogleClientConfig(auth.orgId)
      if (!client) return fail('missing_app_credentials')

      const result = await exchangeCodeForTokens(auth.orgId, code, redirectUri)
      if (!result.ok) return fail(result.error || 'token_exchange_failed')

      const ok = new URL('/settings?tab=google', origin)
      ok.searchParams.set('google_connected', result.email || '1')
      const res = NextResponse.redirect(ok.toString())
      res.cookies.delete('google_oauth_csrf')
      return res
    }

    // ---------- Inicio del flujo ----------
    const client = await getGoogleClientConfig(auth.orgId)
    if (!client) {
      if ((req.headers.get('accept') || '').includes('text/html') || url.searchParams.get('redirect') === '1') {
        return fail('missing_app_credentials')
      }
      return json(
        {
          error:
            'Google OAuth no configurado. Guarda primero el Client ID y Client Secret en Configuración → Google.',
        },
        { status: 400 }
      )
    }

    // state anti-CSRF firmado: orgId.nonce.exp.hmac
    const nonce = crypto.randomBytes(16).toString('hex')
    const exp = Date.now() + 10 * 60 * 1000
    const payload = `${auth.orgId}.${nonce}.${exp}`
    const sig = crypto
      .createHmac('sha256', process.env.APP_SECRET as string)
      .update(payload)
      .digest('hex')
    const state = `${payload}.${sig}`

    const oauthUrl = buildOAuthUrl(client.clientId, redirectUri, state)

    // Cliente API (JSON): misma conducta que antes, { url, redirectUri }
    if (!(req.headers.get('accept') || '').includes('text/html') && url.searchParams.get('redirect') !== '1') {
      return json({ url: oauthUrl, redirectUri })
    }

    const res = NextResponse.redirect(oauthUrl)
    res.cookies.set('google_oauth_csrf', state, {
      httpOnly: true,
      sameSite: 'lax', // navegación superior de vuelta desde Google: la cookie SÍ viaja
      secure: proto === 'https',
      path: '/api/google/auth',
      maxAge: 600,
    })
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
