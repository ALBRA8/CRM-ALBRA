import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireAdmin } from '@/lib/auth'
import { handle } from '@/lib/api-helpers'
import {
  getIntegration,
  parseTikTokState,
  tiktokAuthBase,
} from '@/lib/integrations'

/**
 * GET /api/tiktok/oauth/start — "Conectar TikTok" (flujo ManyChat, Login Kit v2).
 * State CSRF firmado con APP_SECRET en cookie httpOnly + redirección al
 * diálogo de autorización de TikTok. Los secretos jamás van al navegador.
 * Scopes: user_info.basic siempre; extraScopes (aprobados por TikTok) si existen.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const tt = parseTikTokState(integration.tiktokTokenEnc)

    const appKey = (tt.appKey || '').trim()
    const settingsUrl = new URL('/settings?tab=tiktok', req.url)
    if (!appKey) {
      settingsUrl.searchParams.set('tt_error', 'missing_app_key')
      return NextResponse.redirect(settingsUrl)
    }

    // redirect_uri EXACTO: debe estar registrado en la app de TikTok (Login Kit)
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    const host =
      req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
      req.headers.get('host') ||
      new URL(req.url).host
    const origin = proto && host ? `${proto}://${host}` : new URL(req.url).origin
    const redirectUri = `${origin}/api/tiktok/oauth/callback`

    const nonce = crypto.randomBytes(16).toString('hex')
    const exp = Date.now() + 10 * 60 * 1000
    const payload = `${auth.orgId}.${nonce}.${exp}`
    const sig = crypto
      .createHmac('sha256', process.env.APP_SECRET as string)
      .update(payload)
      .digest('hex')
    const state = `${payload}.${sig}`

    const scopes = ['user_info.basic', ...(tt.extraScopes ? tt.extraScopes.split(',').map((s) => s.trim()).filter(Boolean) : [])].join(',')

    const dialog = new URL(`${tiktokAuthBase()}/v2/auth/authorize/`)
    dialog.searchParams.set('client_key', appKey)
    dialog.searchParams.set('scope', scopes)
    dialog.searchParams.set('response_type', 'code')
    dialog.searchParams.set('redirect_uri', redirectUri)
    dialog.searchParams.set('state', state)

    const res = NextResponse.redirect(dialog.toString())
    res.cookies.set('tt_oauth_csrf', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: proto === 'https',
      path: '/api/tiktok/oauth',
      maxAge: 600,
    })
    return res
  })
}
