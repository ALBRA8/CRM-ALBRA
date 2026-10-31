import { db } from './db'
import { decryptSecret, encryptSecret } from './crypto'

/**
 * Helpers de Google Workspace sin dependencias (fetch puro contra las APIs oficiales).
 * Config guardada en Integration:
 *  - googleClientJsonEnc: JSON cifrado { clientId, clientSecret }
 *  - googleRefreshTokenEnc: refresh token cifrado (OAuth offline)
 * Todo con degradación elegante: si no hay config → null / connected:false, nunca 500.
 */

export interface GoogleClientConfig {
  clientId: string
  clientSecret: string
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export async function getGoogleClientConfig(orgId: string): Promise<GoogleClientConfig | null> {
  const integration = await db.integration.findUnique({ where: { organizationId: orgId } })
  const raw = decryptSecret(integration?.googleClientJsonEnc)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as GoogleClientConfig
    if (parsed.clientId && parsed.clientSecret) return parsed
    return null
  } catch {
    return null
  }
}

export async function saveGoogleClientConfig(orgId: string, clientId: string, clientSecret: string): Promise<void> {
  const existing = await db.integration.findUnique({ where: { organizationId: orgId } })
  if (existing) {
    await db.integration.update({
      where: { organizationId: orgId },
      data: { googleClientJsonEnc: encryptSecret(JSON.stringify({ clientId, clientSecret })), enableGoogle: true },
    })
  } else {
    await db.integration.create({
      data: {
        organizationId: orgId,
        googleClientJsonEnc: encryptSecret(JSON.stringify({ clientId, clientSecret })),
        enableGoogle: true,
      },
    })
  }
}

export async function getGoogleRefreshToken(orgId: string): Promise<string | null> {
  const integration = await db.integration.findUnique({ where: { organizationId: orgId } })
  return decryptSecret(integration?.googleRefreshTokenEnc)
}

export async function saveGoogleRefreshToken(orgId: string, refreshToken: string): Promise<void> {
  await db.integration.upsert({
    where: { organizationId: orgId },
    update: { googleRefreshTokenEnc: encryptSecret(refreshToken), enableGoogle: true },
    create: { organizationId: orgId, googleRefreshTokenEnc: encryptSecret(refreshToken), enableGoogle: true },
  })
}

/** Email de la cuenta conectada (userinfo al terminar el OAuth). Se muestra en Ajustes. */
export async function saveGoogleEmail(orgId: string, email: string): Promise<void> {
  await db.integration.upsert({
    where: { organizationId: orgId },
    update: { googleEmail: email },
    create: { organizationId: orgId, googleEmail: email },
  })
}

export async function clearGoogleConnection(orgId: string): Promise<void> {
  await db.integration.updateMany({
    where: { organizationId: orgId },
    data: { googleRefreshTokenEnc: null, googleEmail: null, enableGoogle: false },
  })
}

/**
 * Bases de Google. Override SOLO para pruebas E2E con mock local
 * (GOOGLE_AUTH_BASE / GOOGLE_TOKEN_BASE / GOOGLE_USERINFO_BASE);
 * en producción siempre las oficiales.
 */
export function googleAuthBase(): string {
  return (process.env.GOOGLE_AUTH_BASE || 'https://accounts.google.com').replace(/\/+$/, '')
}

export function googleTokenBase(): string {
  return (process.env.GOOGLE_TOKEN_BASE || 'https://oauth2.googleapis.com').replace(/\/+$/, '')
}

export function googleUserinfoBase(): string {
  return (process.env.GOOGLE_USERINFO_BASE || 'https://openidconnect.googleapis.com').replace(/\/+$/, '')
}

/** Intercambia el refresh token por un access token (60 min). */
export async function getAccessToken(orgId: string): Promise<string | null> {
  const client = await getGoogleClientConfig(orgId)
  const refreshToken = await getGoogleRefreshToken(orgId)
  if (!client || !refreshToken) return null
  try {
    const res = await fetch(`${googleTokenBase()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { access_token?: string }
    return data.access_token || null
  } catch {
    return null
  }
}

/**
 * Intercambia un authorization code (callback OAuth) por tokens, guarda el
 * refresh token y resuelve el email de la cuenta (userinfo). Devuelve un
 * resultado estructurado con el email para mostrarlo en Ajustes.
 */
export async function exchangeCodeForTokens(
  orgId: string,
  code: string,
  redirectUri: string
): Promise<{ ok: boolean; email?: string; error?: string }> {
  const client = await getGoogleClientConfig(orgId)
  if (!client) return { ok: false, error: 'no_client_config' }
  try {
    const res = await fetch(`${googleTokenBase()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      await res.text().catch(() => '')
      return { ok: false, error: 'token_endpoint_reject' }
    }
    const data = (await res.json()) as { refresh_token?: string; access_token?: string }
    if (!data.refresh_token) return { ok: false, error: 'no_refresh_token' }
    await saveGoogleRefreshToken(orgId, data.refresh_token)

    // Identidad de la cuenta (email) — best-effort: si falla, la conexión sigue válida
    let email: string | undefined
    try {
      const uiRes = await fetch(`${googleUserinfoBase()}/v1/userinfo`, {
        headers: { Authorization: `Bearer ${data.access_token || ''}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (uiRes.ok) {
        const ui = (await uiRes.json()) as { email?: string }
        if (ui.email) {
          email = ui.email
          await saveGoogleEmail(orgId, ui.email)
        }
      }
    } catch {
      // sin email no se rompe la conexión
    }
    return { ok: true, email }
  } catch {
    return { ok: false, error: 'token_exchange_failed' }
  }
}

/** Helper JSON autenticado para las APIs de Google. Devuelve null si falla. */
export async function googleApi<T>(accessToken: string, url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      console.error('[google] API', url, res.status, await res.text().catch(() => ''))
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error('[google] API error', url, err)
    return null
  }
}

export function buildOAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${googleAuthBase()}/o/oauth2/v2/auth?${params.toString()}`
}

/** Construye un mensaje RFC822 simple y lo envía por Gmail API. */
export async function sendGmailMessage(accessToken: string, to: string, subject: string, html: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const raw = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
  ].join('\r\n')
  const res = await googleApi<{ id?: string; error?: { message?: string } }>(accessToken, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
  })
  if (res?.id) return { ok: true, id: res.id }
  return { ok: false, error: (res as unknown as { error?: { message?: string } })?.error?.message || 'Gmail API no respondió' }
}
