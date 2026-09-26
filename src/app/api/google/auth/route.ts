import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { getGoogleClientConfig, buildOAuthUrl, exchangeCodeForTokens } from '@/lib/google'

/**
 * GET /api/google/auth
 * - Sin config OAuth → 400 con mensaje claro.
 * - Con ?code= (callback de Google) → intercambia el código y guarda el refresh token.
 * - Normal → devuelve { url }; si es navegación del browser (Accept: text/html) redirige 302.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const url = new URL(req.url)
    const origin = url.origin
    const redirectUri = `${origin}/api/google/auth`

    const client = await getGoogleClientConfig(auth.orgId)
    if (!client) {
      return json(
        {
          error:
            'Google OAuth no configurado. Guarda primero el Client ID y Client Secret en Configuración → Google (settings-page).',
        },
        { status: 400 }
      )
    }

    // Callback: Google devuelve ?code= y ?state=
    const code = url.searchParams.get('code')
    if (code) {
      const ok = await exchangeCodeForTokens(auth.orgId, code, redirectUri)
      const target = new URL('/settings', origin)
      target.searchParams.set('google', ok ? 'connected' : 'error')
      return NextResponse.redirect(target.toString())
    }

    const oauthUrl = buildOAuthUrl(client.clientId, redirectUri, auth.orgId)
    const accept = req.headers.get('accept') || ''
    if (accept.includes('text/html') || url.searchParams.get('redirect') === '1') {
      return NextResponse.redirect(oauthUrl)
    }
    return json({ url: oauthUrl, redirectUri })
  })
}
