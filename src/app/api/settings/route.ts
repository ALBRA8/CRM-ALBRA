import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/crypto'
import { requireAuth } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET    /api/settings — configuración SIN secretos (flags + preview enmascarado).
 *   Shape consumido por chat-page.tsx (data.llm.apiKeyConfigured, data.system.provider)
 *   y settings-page.tsx (SettingsData completo).
 * PUT    /api/settings — (admin) cifra llmApiKey con AES-256-GCM; provider openai|groq|custom.
 * DELETE /api/settings — (admin) borra SOLO la llave LLM.
 */

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
}

function smtpFromEnv() {
  return {
    host: process.env.SMTP_HOST || null,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    fromName: process.env.SMTP_FROM_NAME || null,
  }
}

async function loadOrCreate(orgId: string) {
  const settings = await db.settings.findUnique({ where: { organizationId: orgId } })
  if (settings) return settings
  return db.settings.create({ data: { organizationId: orgId } })
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const [settings, org] = await Promise.all([
      db.settings.findUnique({ where: { organizationId: auth.orgId } }),
      db.organization.findUnique({ where: { id: auth.orgId }, select: { name: true } }),
    ])
    const apiKey = decryptSecret(settings?.llmApiKeyEnc)
    const envSmtp = smtpFromEnv()
    const smtpHost = settings?.smtpHost || envSmtp.host
    const smtpConfigured = !!(smtpHost && (settings?.smtpUser || envSmtp.user))

    return json({
      llm: {
        apiKeyConfigured: !!apiKey,
        apiKeyPreview: maskSecret(apiKey),
        baseUrl: settings?.llmBaseUrl || '',
        model: settings?.llmModel || '',
        provider: settings?.llmProvider || null,
      },
      email: {
        configured: smtpConfigured,
        host: smtpHost || '',
        fromName: envSmtp.fromName || org?.name || 'CRM ALBRA',
      },
      app: {
        name: org?.name || 'CRM ALBRA',
        url: new URL(req.url).origin,
      },
      system: {
        usingZaiSdk: !apiKey,
        provider: apiKey ? settings?.llmProvider || 'custom' : 'SDK Z-AI',
        chatEnabled: true, // siempre: hay fallback z-ai-web-dev-sdk sin llave
      },
    })
  })
}

interface SettingsBody {
  llm?: {
    apiKey?: string | null
    baseUrl?: string | null
    model?: string | null
    provider?: string | null
  }
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const body = (await req.json().catch(() => ({}))) as SettingsBody

    await loadOrCreate(auth.orgId)

    const data: Record<string, unknown> = {}
    if (body.llm) {
      const { apiKey, baseUrl, model, provider } = body.llm
      if (apiKey !== undefined && apiKey !== null && apiKey.trim() !== '') {
        data.llmApiKeyEnc = encryptSecret(apiKey.trim())
        // Si el usuario no especifica provider, infiérelo del baseUrl
        if (!provider && !baseUrl) data.llmProvider = 'custom'
      }
      if (baseUrl !== undefined) data.llmBaseUrl = baseUrl ? String(baseUrl).trim() : null
      if (model !== undefined) data.llmModel = model ? String(model).trim() : null
      if (provider !== undefined) {
        if (provider === null || provider === '') data.llmProvider = null
        else if (['openai', 'groq', 'together', 'custom', 'zai'].includes(provider)) data.llmProvider = provider
      }
      // Si eligió un provider conocido sin baseUrl explícita, usa la oficial
      if (typeof data.llmProvider === 'string' && PROVIDER_BASE_URLS[data.llmProvider] && !data.llmBaseUrl) {
        data.llmBaseUrl = PROVIDER_BASE_URLS[data.llmProvider]
      }
    }

    const settings = await db.settings.update({ where: { organizationId: auth.orgId }, data })

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'settings',
      entityId: settings.id,
      details: { fields: Object.keys(data).map((f) => (f === 'llmApiKeyEnc' ? 'llmApiKey(encrypted)' : f)) },
    })

    return json({ success: true, llm: { apiKeyConfigured: !!decryptSecret(settings.llmApiKeyEnc), baseUrl: settings.llmBaseUrl || '', model: settings.llmModel || '' } })
  })
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    await loadOrCreate(auth.orgId)
    await db.settings.update({ where: { organizationId: auth.orgId }, data: { llmApiKeyEnc: null } })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'settings',
      details: { cleared: 'llmApiKey' },
    })
    return json({ success: true, usingZaiSdk: true })
  })
}
