import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { getIntegration, parseTelegramState, encodeTelegramState, generateWebhookSecret } from '@/lib/integrations'
import { auditAndTimeline } from '@/lib/api-helpers'
import { encryptSecret, decryptSecret } from '@/lib/crypto'
import { createHash } from 'crypto'

/**
 * POST /api/telegram/set-webhook — configura el webhook en Telegram Bot API
 * apuntando a /api/telegram/webhook con el secret de la organización.
 * Respuesta: { success, botUsername?, webhookUrl?, instructions?, error? }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = await requireAdmin(req)
    const integration = await getIntegration(auth.orgId)
    const state = parseTelegramState(integration.telegramBotTokenEnc)
    if (!state.token) {
      return json({
        success: false,
        error: 'Bot token no configurado. Guarda primero el token en Configuración → Telegram.',
        instructions: 'Obtén el token con @BotFather en Telegram y pégalo en Configuración → Telegram.',
      })
    }

    const origin = new URL(req.url).origin
    const webhookUrl = `${origin}/api/telegram/webhook`
    // (A2-07, auditoría 2026-11-11) El secret se guarda CIFRADO (AES-256-GCM,
    // convención *Enc del propio schema) y se indexa por HASH para el lookup
    // del webhook — el valor en claro nunca vuelve a tocar la BD.
    const storedSecret = decryptSecret(integration.telegramSecret)
    const telegramSecret = storedSecret || generateWebhookSecret()
    if (!storedSecret) {
      await db.integration.update({
        where: { organizationId: auth.orgId },
        data: { telegramSecret: encryptSecret(telegramSecret), telegramSecretHash: createHash('sha256').update(telegramSecret).digest('hex') },
      })
    }

    // 1) getMe para el username del bot
    let botUsername: string | null = null
    try {
      const res = await fetch(`https://api.telegram.org/bot${state.token}/getMe`, { signal: AbortSignal.timeout(10_000) })
      const data = (await res.json()) as { ok?: boolean; result?: { username?: string } }
      if (data.ok && data.result?.username) {
        botUsername = data.result.username
        state.botUsername = botUsername
        await db.integration.update({ where: { organizationId: auth.orgId }, data: { telegramBotTokenEnc: encodeTelegramState(state) } })
      }
    } catch {
      /* getMe es best-effort */
    }

    // 2) setWebhook con secret_token
    try {
      const res = await fetch(`https://api.telegram.org/bot${state.token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: telegramSecret,
          allowed_updates: ['message', 'edited_message', 'channel_post'],
        }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json()) as { ok?: boolean; description?: string }
      if (data.ok) {
        await auditAndTimeline({
          orgId: auth.orgId,
          userId: auth.userId,
          action: 'updated',
          entity: 'integration',
          details: { provider: 'telegram', webhookConfigured: true, botUsername },
        })
        return json({
          success: true,
          botUsername,
          webhookUrl,
          instructions: `Webhook configurado en Telegram. URL: ${webhookUrl}. Los mensajes de @${botUsername || 'tu bot'} llegarán al CRM con auto-respuesta IA.`,
        })
      }
      return json({ success: false, error: data.description || 'Telegram rechazó el webhook', webhookUrl })
    } catch (err) {
      return json({
        success: false,
        error: `No se pudo contactar Telegram: ${err instanceof Error ? err.message : 'error de red'}`,
        webhookUrl,
        instructions: `Configura manualmente con la API: setWebhook con url=${webhookUrl} y secret_token=${telegramSecret.slice(0, 6)}•••`,
      })
    }
  })
}
