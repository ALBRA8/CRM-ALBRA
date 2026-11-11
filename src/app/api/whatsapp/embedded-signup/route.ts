/**
 * GET  /api/whatsapp/embedded-signup — configuración PÚBLICA para lanzar el
 *      Embedded Signup de Meta desde el frontend (app_id/config_id; JAMÁS el
 *      app secret) + estado firmado anti-CSRF de un solo uso.
 * POST /api/whatsapp/embedded-signup — callback oficial: intercambia code→token
 *      (server-side) y registra la conexión cifrada para la organización del estado.
 *
 * Decisión 2026-11-11 (punto 10): conexión SOLO por el flujo oficial de Meta.
 * El cliente nunca comparte contraseñas: Meta entrega un `code` de un solo uso
 * que el servidor canjea con el app secret (que vive SOLO en el servidor).
 *
 * El orgId de la conexión SIEMPRE proviene del `state` firmado por el servidor
 * (jamás del body del cliente): cierre de la excepción de seguridad de
 * organización enviada por el cliente.
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handle, json, readBody, str } from '../../_lib/shared'
import { requireAuth, HttpError } from '@/lib/auth'
import {
  createConnection, signSignupState, verifySignupState, newSignupNonce, embeddedSignupConfig, auditEvent,
} from '@/lib/wa-connections'
import { metaAppConfig, exchangeCodeForToken } from '@/lib/meta-oauth'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const config = embeddedSignupConfig()
    if (!config) {
      throw new HttpError(503, 'Embedded Signup no configurado: faltan META_APP_ID / META_APP_SECRET en el servidor')
    }
    const state = signSignupState(auth.orgId, newSignupNonce())
    return json({ appId: config.appId, configId: config.configId, graphVersion: config.graphVersion, state })
  })
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAuth(req)
    const body = await readBody(req)
    const code = str(body.code)
    const state = str(body.state)
    const phoneNumberId = str(body.phoneNumberId)
    const wabaId = str(body.wabaId)
    if (!code || !state || !phoneNumberId) {
      throw new HttpError(400, 'Campos requeridos: code, state, phoneNumberId')
    }

    // El estado firmado define la organización de destino (anti-CSRF OAuth).
    // Debe coincidir con la sesión: un estado de otra org es rechazado.
    const verified = verifySignupState(state)
    if (!verified.ok || !verified.orgId) throw new HttpError(400, verified.error ?? 'Estado inválido')
    if (verified.orgId !== auth.orgId) {
      throw new HttpError(403, 'El estado de conexión no corresponde a esta sesión')
    }

    const app = metaAppConfig()
    if (!app) throw new HttpError(503, 'Embedded Signup no configurado en el servidor')

    // Intercambio code→token SERVER-SIDE (el app secret nunca sale del servidor).
    const exchanged = await exchangeCodeForToken(code, app)
    if (!exchanged.ok || !exchanged.accessToken) {
      await auditEvent(null, auth.orgId, 'error', `Embedded Signup: canje de code falló: ${exchanged.error}`)
      throw new HttpError(400, `Meta rechazó el canje del código: ${exchanged.error}`)
    }

    const result = await createConnection({
      orgId: auth.orgId,
      phoneNumberId,
      accessToken: exchanged.accessToken,
      wabaId,
      source: 'embedded_signup',
    })
    if (!result.ok) {
      const status = result.code === 'plan_limit' ? 402 : result.code === 'duplicate' ? 409 : 400
      throw new HttpError(status, result.message)
    }
    return json({ ok: true, connectionId: result.connectionId, status: result.status }, { status: 201 })
  })
}
