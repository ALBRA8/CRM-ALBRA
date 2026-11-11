import { randomBytes } from 'node:crypto'

/**
 * meta-oauth.ts — Flujo oficial de autorización de Meta (OLEADA 2).
 *
 * Decisión de negocio 2026-11-11 (punto 10): la conexión de números de
 * WhatsApp se hace mediante el flujo oficial de Meta (Embedded Signup /
 * OAuth), sin pedir a los clientes que compartan contraseñas.
 *
 * Flujo Embedded Signup (WhatsApp Business Platform):
 *  1. El frontend lanza el SDK de Meta con config_id + app_id (GET /api/whatsapp/embedded-signup).
 *  2. Meta llama a nuestro callback con sessionInfo { waba_id, phone_number_id } y
 *     entrega un `code` de un solo uso.
 *  3. POST /api/whatsapp/embedded-signup intercambia code→token contra
 *     https://graph.facebook.com/v21.0/oauth/access_token (server-side; el app
 *     secret NUNCA sale del servidor).
 *  4. Se valida la identidad del token (GET /me?fields=id) y se persiste cifrado.
 *
 * Las funciones de red aceptan un `fetchImpl` inyectable para pruebas
 * automatizadas sin red real (regla 9: toda funcionalidad con pruebas).
 */

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH_BASE = 'https://graph.facebook.com'

export interface MetaAppConfig {
  appId: string
  appSecret: string
  configId?: string
}

/** Configuración de la app Meta de plataforma (fail-closed si falta). */
export function metaAppConfig(): MetaAppConfig | null {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return null
  return { appId, appSecret, configId: process.env.META_CONFIG_ID }
}

export interface ExchangeResult {
  ok: boolean
  accessToken?: string
  tokenType?: string
  error?: string
}

/** Intercambia un `code` de Embedded Signup por un token de acceso (server-side). */
export async function exchangeCodeForToken(
  code: string,
  app: MetaAppConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/oauth/access_token`)
  url.searchParams.set('client_id', app.appId)
  url.searchParams.set('client_secret', app.appSecret)
  url.searchParams.set('code', code)
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string
      token_type?: string
      error?: { message?: string }
    }
    if (!res.ok || !body.access_token) {
      return { ok: false, error: body.error?.message || `graph oauth ${res.status}` }
    }
    return { ok: true, accessToken: body.access_token, tokenType: body.token_type }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'exchange failed' }
  }
}

export interface TokenIdentityResult {
  ok: boolean
  /** id de la entidad que el token representa (WABA/usuario sistema). */
  id?: string
  error?: string
}

/** Valida un token contra GET /me — la identidad REAL que representa. */
export async function inspectTokenIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenIdentityResult> {
  try {
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}/me?access_token=${encodeURIComponent(accessToken)}`
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!res.ok || !body.id) return { ok: false, error: body.error?.message || `graph me ${res.status}` }
    return { ok: true, id: body.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'inspect failed' }
  }
}

export interface PhoneNumberInfo {
  ok: boolean
  id?: string
  phoneNumber?: string
  displayPhoneNumber?: string
  verifiedName?: string
  wabaId?: string
  error?: string
}

/**
 * Consulta GET /{phone_number_id}?fields=id,phone_number,verified_name
 * con el token de la conexión — verifica que el número EXISTE y es operable
 * con ese token (decisión #4: atribución por phoneNumberId debe apuntar a un
 * número real de la WABA autorizada).
 */
export async function fetchPhoneNumberInfo(
  phoneNumberId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PhoneNumberInfo> {
  try {
    const fields = 'id,phone_number,verified_name'
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
    const body = (await res.json().catch(() => ({}))) as {
      id?: string
      phone_number?: string
      display_phone_number?: string
      verified_name?: string
      error?: { message?: string }
    }
    if (!res.ok || !body.id) return { ok: false, error: body.error?.message || `graph phone ${res.status}` }
    return {
      ok: true,
      id: body.id,
      phoneNumber: body.phone_number,
      displayPhoneNumber: body.display_phone_number ?? body.phone_number,
      verifiedName: body.verified_name,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'phone fetch failed' }
  }
}

/** verify_token de webhook por conexión: 24 bytes aleatorios en hex. */
export function generateWebhookVerifyToken(): string {
  return randomBytes(24).toString('hex')
}
