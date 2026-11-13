/**
 * Backfill idempotente de conexiones legacy hacia ChannelConnection.
 *
 * Por defecto SOLO diagnostica. Para escribir se requieren ambos:
 *   bun run scripts/backfill-channel-connections.ts --apply
 *   BACKFILL_CHANNEL_CONNECTIONS_CONFIRM=1
 * En NODE_ENV=production también exige BACKFILL_CHANNEL_CONNECTIONS_ALLOW_PRODUCTION=1.
 *
 * Nunca actualiza ni borra Integration/WhatsAppConnection. Los conflictos
 * (misma clave de proveedor asociada a otro tenant o datos incompatibles) se
 * reportan como conteos sin revelar IDs, tokens o nombres de cuenta.
 */
import { db } from '../src/lib/db'
import { decryptSecret, encryptSecret } from '../src/lib/crypto'
import {
  parseFacebookState,
  parseInstagramState,
  parseTikTokState,
} from '../src/lib/integrations'

type ConnectionPlan = {
  organizationId: string
  channel: string
  provider: string
  providerAccountKey: string
  externalAccountId: string
  displayName: string | null
  status: string
  credentialsEnc: string
  metadata: string
  source: string
}

type Result = 'created' | 'already_present' | 'conflict'

const apply = process.argv.includes('--apply')
if (apply && process.env.BACKFILL_CHANNEL_CONNECTIONS_CONFIRM !== '1') {
  throw new Error('Para aplicar, define BACKFILL_CHANNEL_CONNECTIONS_CONFIRM=1 además de --apply')
}
if (apply && process.env.NODE_ENV === 'production' && process.env.BACKFILL_CHANNEL_CONNECTIONS_ALLOW_PRODUCTION !== '1') {
  throw new Error('Backfill bloqueado en producción: requiere BACKFILL_CHANNEL_CONNECTIONS_ALLOW_PRODUCTION=1')
}

function safeDecrypt(value: string | null | undefined) {
  try {
    return decryptSecret(value)
  } catch {
    return null
  }
}

function encryptedCredentials(value: unknown) {
  const encrypted = encryptSecret(JSON.stringify(value))
  return encrypted || null
}

function safeParseState<T extends object>(parser: (value: string | null | undefined) => T, value: string | null | undefined): T {
  try {
    return parser(value)
  } catch {
    return {} as T
  }
}

async function persistPlan(plan: ConnectionPlan): Promise<Result> {
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.channelConnection.findUnique({
        where: { providerAccountKey: plan.providerAccountKey },
        select: {
          organizationId: true,
          channel: true,
          provider: true,
          externalAccountId: true,
        },
      })
      if (existing) {
        return existing.organizationId === plan.organizationId &&
          existing.channel === plan.channel &&
          existing.provider === plan.provider &&
          existing.externalAccountId === plan.externalAccountId
          ? 'already_present'
          : 'conflict'
      }
      if (!apply) return 'created'

      const connection = await tx.channelConnection.create({
        data: {
          organizationId: plan.organizationId,
          channel: plan.channel,
          provider: plan.provider,
          providerAccountKey: plan.providerAccountKey,
          externalAccountId: plan.externalAccountId,
          displayName: plan.displayName,
          status: plan.status,
          credentialsEnc: plan.credentialsEnc,
          metadata: plan.metadata,
        },
      })
      await tx.channelConnectionEvent.create({
        data: {
          organizationId: plan.organizationId,
          connectionId: connection.id,
          type: 'legacy_backfill',
          detail: `legacy_source=${plan.source}`,
        },
      })
      return 'created'
    })
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'P2002') return 'conflict'
    throw error
  }
}

async function main() {
  const totals = {
    mode: apply ? 'apply' : 'dry-run',
    planned: 0,
    createdOrWouldCreate: 0,
    alreadyPresent: 0,
    conflicts: 0,
    duplicateSources: 0,
    skipped: 0,
    byChannel: {} as Record<string, { createdOrWouldCreate: number; alreadyPresent: number; conflicts: number; skipped: number }>,
  }

  const count = (channel: string, result: Result | 'skipped') => {
    const bucket = totals.byChannel[channel] ||= {
      createdOrWouldCreate: 0, alreadyPresent: 0, conflicts: 0, skipped: 0,
    }
    if (result === 'created') {
      totals.createdOrWouldCreate += 1
      bucket.createdOrWouldCreate += 1
    } else if (result === 'already_present') {
      totals.alreadyPresent += 1
      bucket.alreadyPresent += 1
    } else if (result === 'conflict') {
      totals.conflicts += 1
      bucket.conflicts += 1
    } else {
      totals.skipped += 1
      bucket.skipped += 1
    }
  }

  const plans: ConnectionPlan[] = []

  // WhatsApp Cloud: prefer the per-number inventory; preserve legacy lifecycle.
  const whatsappConnections = await db.whatsAppConnection.findMany()
  for (const legacy of whatsappConnections) {
    const phoneId = legacy.phoneNumberId?.trim()
    const accessToken = safeDecrypt(legacy.accessTokenEnc)
    if (!phoneId || !accessToken) {
      count('whatsapp', 'skipped')
      continue
    }
    const appSecret = safeDecrypt(legacy.metaAppSecretEnc) || process.env.META_APP_SECRET || null
    const credentialsEnc = encryptedCredentials({
      accessToken,
      appSecret,
      webhookVerifyToken: legacy.webhookVerifyToken,
    })
    if (!credentialsEnc) {
      count('whatsapp', 'skipped')
      continue
    }
    plans.push({
      organizationId: legacy.organizationId,
      channel: 'whatsapp',
      provider: 'meta_cloud',
      providerAccountKey: `meta:whatsapp:${phoneId}`,
      externalAccountId: phoneId,
      displayName: legacy.displayName || legacy.phoneNumber || null,
      status: legacy.status,
      credentialsEnc,
      metadata: JSON.stringify({
        legacyBackfill: true,
        source: 'WhatsAppConnection',
        wabaId: legacy.wabaId || null,
        phoneNumber: legacy.phoneNumber || null,
      }),
      source: 'WhatsAppConnection',
    })
  }

  // Legacy single-account Integration records: create only when identity + token are exact.
  const integrations = await db.integration.findMany()
  for (const legacy of integrations) {
    const appSecret = safeDecrypt(legacy.metaAppSecretEnc) || process.env.META_APP_SECRET || null

    if (legacy.instagramAccountId && legacy.instagramTokenEnc && legacy.enableInstagram) {
      const state = safeParseState(parseInstagramState, legacy.instagramTokenEnc)
      if (state.token) {
        const credentialsEnc = encryptedCredentials({
          accessToken: state.token,
          appSecret: state.webhookSecret || appSecret,
          webhookVerifyToken: state.webhookVerifyToken || null,
        })
        if (credentialsEnc) {
          plans.push({
            organizationId: legacy.organizationId,
            channel: 'instagram',
            provider: 'meta_graph',
            providerAccountKey: `meta:instagram:${legacy.instagramAccountId}`,
            externalAccountId: legacy.instagramAccountId,
            displayName: null,
            status: 'connected',
            credentialsEnc,
            metadata: JSON.stringify({ legacyBackfill: true, source: 'Integration' }),
            source: 'Integration.instagram',
          })
        } else count('instagram', 'skipped')
      } else count('instagram', 'skipped')
    }

    if (legacy.whatsappPhoneId && legacy.whatsappCloudTokenEnc && legacy.enableWhatsApp) {
      const accessToken = safeDecrypt(legacy.whatsappCloudTokenEnc)
      const credentialsEnc = accessToken ? encryptedCredentials({
        accessToken,
        appSecret,
        webhookVerifyToken: null,
      }) : null
      if (credentialsEnc) {
        plans.push({
          organizationId: legacy.organizationId,
          channel: 'whatsapp',
          provider: 'meta_cloud',
          providerAccountKey: `meta:whatsapp:${legacy.whatsappPhoneId}`,
          externalAccountId: legacy.whatsappPhoneId,
          displayName: null,
          status: 'connected',
          credentialsEnc,
          metadata: JSON.stringify({ legacyBackfill: true, source: 'Integration' }),
          source: 'Integration.whatsapp',
        })
      } else count('whatsapp', 'skipped')
    }

    if (legacy.facebookTokenEnc && legacy.enableFacebook) {
      const state = safeParseState(parseFacebookState, legacy.facebookTokenEnc)
      const pageId = state.pageId || legacy.facebookPageId
      if (pageId && state.pageToken) {
        const credentialsEnc = encryptedCredentials({
          accessToken: state.pageToken,
          appSecret,
          webhookVerifyToken: state.webhookVerifyToken || null,
        })
        if (credentialsEnc) {
          plans.push({
            organizationId: legacy.organizationId,
            channel: 'messenger',
            provider: 'meta_graph',
            providerAccountKey: `meta:messenger:${pageId}`,
            externalAccountId: pageId,
            displayName: state.pageName || legacy.facebookPageName || null,
            status: 'pending', // inventario creado; el adaptador/outbox Messenger sigue pendiente
            credentialsEnc,
            metadata: JSON.stringify({ legacyBackfill: true, source: 'Integration' }),
            source: 'Integration.facebook',
          })
        } else count('messenger', 'skipped')
      } else count('messenger', 'skipped')
    }

    if (legacy.telegramBotTokenEnc && legacy.enableTelegram) {
      const botToken = safeDecrypt(legacy.telegramBotTokenEnc)
      const botId = botToken?.match(/^(\d+):/)?.[1]
      if (botToken && botId) {
        const credentialsEnc = encryptedCredentials({
          botToken,
          webhookSecret: legacy.telegramSecret || null,
        })
        if (credentialsEnc) {
          plans.push({
            organizationId: legacy.organizationId,
            channel: 'telegram',
            provider: 'telegram_bot',
            providerAccountKey: `telegram:bot:${botId}`,
            externalAccountId: botId,
            displayName: null,
            status: 'pending', // inventario creado; el adaptador/outbox Telegram sigue pendiente
            credentialsEnc,
            metadata: JSON.stringify({ legacyBackfill: true, source: 'Integration' }),
            source: 'Integration.telegram',
          })
        } else count('telegram', 'skipped')
      } else count('telegram', 'skipped')
    }

    if (legacy.tiktokTokenEnc && legacy.enableTikTok) {
      const state = safeParseState(parseTikTokState, legacy.tiktokTokenEnc)
      if (state.openId && state.accessToken) {
        const credentialsEnc = encryptedCredentials(state)
        if (credentialsEnc) {
          plans.push({
            organizationId: legacy.organizationId,
            channel: 'tiktok',
            provider: 'tiktok_business',
            providerAccountKey: `tiktok:business:${state.openId}`,
            externalAccountId: state.openId,
            displayName: state.displayName || null,
            status: 'pending',
            credentialsEnc,
            metadata: JSON.stringify({ legacyBackfill: true, source: 'Integration' }),
            source: 'Integration.tiktok',
          })
        } else count('tiktok', 'skipped')
      } else count('tiktok', 'skipped')
    }
  }

  // Evita contar dos veces la misma cuenta si aparece tanto en la tabla
  // específica como en Integration legacy. La fuente específica tiene prioridad.
  const uniquePlans: ConnectionPlan[] = []
  const seenPlanKeys = new Map<string, ConnectionPlan>()
  for (const plan of plans) {
    const previous = seenPlanKeys.get(plan.providerAccountKey)
    if (!previous) {
      seenPlanKeys.set(plan.providerAccountKey, plan)
      uniquePlans.push(plan)
      continue
    }
    if (
      previous.organizationId !== plan.organizationId ||
      previous.channel !== plan.channel ||
      previous.provider !== plan.provider ||
      previous.externalAccountId !== plan.externalAccountId
    ) {
      count(plan.channel, 'conflict')
    } else {
      totals.duplicateSources += 1
    }
  }

  totals.planned = uniquePlans.length
  for (const plan of uniquePlans) {
    const result = await persistPlan(plan)
    count(plan.channel, result)
  }

  console.log(JSON.stringify(totals, null, 2))
  if (totals.conflicts > 0) process.exitCode = 2
}

main()
  .catch((error) => {
    console.error('[channel-connection-backfill] failed:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
