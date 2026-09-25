import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { maskSecret } from '@/lib/crypto'
import { getIntegration, parseTelegramState, encodeTelegramState, generateWebhookSecret } from '@/lib/integrations'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET    /api/telegram/config — estado sin secretos ({ configured, config:{ isActive, autoReply, botUsername, hasBotToken } })
 * PUT    /api/telegram/config — (admin) guarda botToken cifrado (AES-256-GCM) + autoReply; genera telegramSecret si no existe
 * DELETE /api/telegram/config — (admin) desconecta
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
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
    const auth = requireAdmin(req)
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

    // Secret para validar el webhook (X-Telegram-Bot-Api-Secret-Token) — se genera una vez
    const telegramSecret = integration.telegramSecret || generateWebhookSecret()

    const updated = await db.integration.update({
      where: { organizationId: auth.orgId },
      data: {
        telegramBotTokenEnc: encodeTelegramState(next),
        telegramSecret,
        enableTelegram: !!next.token,
      },
    })

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
        isActive: updated.enableTelegram,
        autoReply: next.autoReply !== false,
        botUsername: next.botUsername || null,
        hasBotToken: !!next.token,
      },
    })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    await db.integration.update({
      where: { organizationId: auth.orgId },
      data: { telegramBotTokenEnc: null, enableTelegram: false },
    })
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
