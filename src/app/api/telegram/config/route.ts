import type { NextRequest } from 'next/server'
import { requireAdmin, HttpError } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/crypto'
import { getIntegration, parseTelegramState, encodeTelegramState, generateWebhookSecret, saveTelegramConnection } from '@/lib/integrations'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET    /api/telegram/config — estado sin secretos ({ configured, config:{ isActive, autoReply, botUsername, hasBotToken } })
 * PUT    /api/telegram/config — (admin) guarda botToken cifrado (AES-256-GCM) + autoReply; genera telegramSecret si no existe
 * DELETE /api/telegram/config — (admin) desconecta
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const state = parseTelegramState(integration.telegramBotTokenEnc)
    return json({
      configured: !!state.token,
      config: {
        isActive: integration.enableTelegram,
        autoReply: state.autoReply !== false,
        botUsername: state.botUsername || null,
        hasBotToken: !!state.token,
        tokenPreview: maskSecret(state.token),
        secretConfigured: !!integration.telegramSecret,
      },
    })
  })
}

interface TelegramConfigBody {
  botToken?: string
  autoReply?: boolean
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as TelegramConfigBody
    const integration = await getIntegration(auth.orgId)
    const current = parseTelegramState(integration.telegramBotTokenEnc)

    const next = { ...current }
    if (body.botToken !== undefined) {
      const token = String(body.botToken).trim()
      // "_keep" = conservar el token actual (toggle de auto-respuesta desde el UI)
      if (token && token !== '_keep') next.token = token
      else if (!token) next.token = undefined
    }
    if (typeof body.autoReply === 'boolean') next.autoReply = body.autoReply

    // Secret para validar el webhook (X-Telegram-Bot-Api-Secret-Token) — se genera una vez.
    // (A2-23) Se LEE descifrado (decryptSecret devuelve el plano legacy tal cual)
    // y se PERSISTE cifrado dentro del blob + hash de lookup en la conexión canónica.
    const telegramSecret = decryptSecret(integration.telegramSecret) || generateWebhookSecret()

    // (reauditoría ciclo 2) Falla EXPLÍCITA si no hay clave de cifrado: persistir
    // secret null con hash válido dejaría el webhook de la org en 401 silencioso.
    const encSecret = encryptSecret(telegramSecret)
    if (!encSecret) {
      throw new HttpError(500, 'Cifrado no disponible: configura APP_ENCRYPTION_KEY o APP_SECRET')
    }
    // Conexión canónica: blob = estado Telegram (token + autoReply + webhookSecret);
    // el hash del secret vive indexado en ChannelConnection.webhookSecretHash.
    await saveTelegramConnection(auth.orgId, { ...next, webhookSecret: telegramSecret })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'telegram', tokenMasked: maskSecret(next.token), autoReply: next.autoReply !== false },
    })

    return json({
      success: true,
      configured: !!next.token,
      config: {
        isActive: !!next.token,
        autoReply: next.autoReply !== false,
        botUsername: next.botUsername || null,
        hasBotToken: !!next.token,
      },
    })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    // Desconexión canónica: el blob se vacía y la conexión queda disconnected
    // (la fila y su historial de eventos se conservan como audit trail).
    await saveTelegramConnection(auth.orgId, {}, { status: 'disconnected' })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'integration',
      details: { provider: 'telegram', disconnected: true },
    })
    return json({ success: true, configured: false })
  })
}
