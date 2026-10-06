import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { APP_VERSION } from '@/lib/version'

/**
 * GET /api/doctor — AUDIT → DIAGNOSE → VERIFY → REPORT del sistema (owner/admin).
 *
 * Comprueba: BD, esquema Prisma sincronizado, daemon WhatsApp (alcanzable,
 * vinculado y a la org correcta), proveedor IA, memoria (counts),
 * automatizaciones (fallidas 24h, waiting, huérfanas, scheduler atrasado),
 * integraciones configuradas (booleans, NUNCA valores de secretos) y seguridad
 * de configuración.
 *
 * ?fix=1 → aplica ÚNICAMENTE fixes deterministas y seguros (hoy: marcar runs
 * 'running' huérfanos como failed). NUNCA toca datos comerciales.
 */

interface Check {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail?: string
  data?: Record<string, unknown>
}

const DAEMON_URL = process.env.WHATSAPP_DAEMON_URL || 'http://localhost:3002'

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAdmin(req)
    const applyFix = new URL(req.url).searchParams.get('fix') === '1'
    const checks: Check[] = []

    // ---------- 1) BD ----------
    try {
      await db.$queryRaw`SELECT 1`
      checks.push({ id: 'db', label: 'Base de datos (SQLite)', status: 'ok' })
    } catch (err) {
      checks.push({ id: 'db', label: 'Base de datos (SQLite)', status: 'fail', detail: (err as Error).message })
      return json({ version: APP_VERSION, generatedAt: new Date().toISOString(), verdict: 'critical', checks })
    }

    // ---------- 2) Esquema sincronizado (piezas P0 nuevas incluidas) ----------
    try {
      await db.automationRun.findFirst({ select: { idempotencyKey: true } })
      await db.agentMemory.findFirst({ select: { type: true } })
      checks.push({ id: 'schema', label: 'Esquema Prisma sincronizado (db push al día)', status: 'ok' })
    } catch {
      checks.push({ id: 'schema', label: 'Esquema Prisma sincronizado', status: 'warn', detail: 'Faltan columnas nuevas (idempotencyKey/type): ejecutar `npx prisma db push`' })
    }

    // ---------- 3) Configuración de seguridad ----------
    const appSecret = process.env.APP_SECRET || ''
    const internalSecret = process.env.INTERNAL_API_SECRET || ''
    checks.push({
      id: 'security',
      label: 'Secretos de configuración',
      status: appSecret.length >= 24 && internalSecret.length >= 24 ? 'ok' : 'warn',
      detail: `APP_SECRET ${appSecret.length} chars · INTERNAL_API_SECRET ${internalSecret.length} chars (mín. 24)`,
      data: { cronSecretCustom: !!process.env.CRON_SECRET },
    })

    // ---------- 4) Daemon WhatsApp ----------
    type DaemonStatus = { reachable: boolean; status?: string; linkedOrgId?: string | null }
    let daemon: DaemonStatus = { reachable: false }
    try {
      const res = await fetch(`${DAEMON_URL}/status`, {
        headers: { Authorization: `Bearer ${internalSecret}` },
        signal: AbortSignal.timeout(2500),
        cache: 'no-store',
      })
      if (res.ok) {
        const j = (await res.json()) as { status?: string; linkedOrgId?: string | null }
        daemon = { reachable: true, status: j.status, linkedOrgId: j.linkedOrgId ?? null }
      }
    } catch {}
    if (!daemon.reachable) {
      checks.push({ id: 'whatsapp', label: 'Daemon WhatsApp (Baileys)', status: 'warn', detail: `No alcanzable en ${DAEMON_URL}` })
    } else if (daemon.linkedOrgId && daemon.linkedOrgId !== auth.orgId) {
      checks.push({ id: 'whatsapp', label: 'Daemon WhatsApp (Baileys)', status: 'fail', detail: 'La sesión está vinculada a OTRA organización' })
    } else {
      checks.push({ id: 'whatsapp', label: 'Daemon WhatsApp (Baileys)', status: 'ok', data: { connection: daemon.status, orgLinked: !!daemon.linkedOrgId } })
    }

    // ---------- 5) Proveedor IA ----------
    try {
      const settings = await db.settings.findUnique({ where: { organizationId: auth.orgId } })
      const s = settings as { llmBaseUrl?: string; llmModel?: string; llmEmbedModel?: string } | null
      checks.push({
        id: 'ai',
        label: 'Proveedor IA (cerebro + embeddings)',
        status: s?.llmBaseUrl ? 'ok' : 'warn',
        detail: s?.llmBaseUrl ? `baseUrl configurado · modelo ${s.llmModel ?? '(sin modelo)'}` : 'Sin configurar: Configuración → Agente IA',
        data: { embeddings: !!s?.llmEmbedModel },
      })
    } catch {
      checks.push({ id: 'ai', label: 'Proveedor IA', status: 'warn', detail: 'No se pudo leer Settings' })
    }

    // ---------- 6) Memoria ----------
    try {
      const [memories, fragments] = await Promise.all([
        db.agentMemory.count({ where: { organizationId: auth.orgId } }),
        db.conversationEmbedding.count({ where: { organizationId: auth.orgId } }),
      ])
      checks.push({ id: 'memory', label: 'Memoria del agente', status: 'ok', data: { hechos: memories, fragmentosConversacion: fragments } })
    } catch {
      checks.push({ id: 'memory', label: 'Memoria del agente', status: 'warn', detail: 'Tablas de memoria no disponibles (schema viejo)' })
    }

    // ---------- 7) Automatizaciones ----------
    const since = new Date(Date.now() - 86_400_000)
    const [active, failed24h, waiting, orphans, overdue] = await Promise.all([
      db.automation.count({ where: { organizationId: auth.orgId, isActive: true } }),
      db.automationRun.count({ where: { status: 'failed', startedAt: { gte: since }, automation: { organizationId: auth.orgId } } }),
      db.automationRun.count({ where: { status: 'waiting', automation: { organizationId: auth.orgId } } }),
      db.automationRun.count({ where: { status: 'running', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
      db.automation.count({ where: { organizationId: auth.orgId, isActive: true, triggerType: 'schedule', nextRunAt: { lt: new Date(Date.now() - 5 * 60_000) } } }),
    ])
    checks.push({
      id: 'automations',
      label: 'Automatizaciones',
      status: orphans > 0 ? 'warn' : overdue > 0 ? 'warn' : 'ok',
      detail: orphans > 0 ? `${orphans} runs huérfanos (crash) — aplicar ?fix=1` : overdue > 0 ? `${overdue} programadas atrasadas: el scheduler no está corriendo` : undefined,
      data: { activas: active, fallidas24h: failed24h, enEspera: waiting, huerfanas: orphans, atrasadas: overdue },
    })

    // ---------- 8) Integraciones (solo booleans, jamás secretos) ----------
    const integ = (await db.integration.findUnique({ where: { organizationId: auth.orgId } })) as
      | { telegramBotTokenEnc?: string | null; instagramTokenEnc?: string | null; enableGoogle?: boolean } | null
    checks.push({
      id: 'integrations',
      label: 'Integraciones de canal',
      status: 'ok',
      data: { telegram: !!integ?.telegramBotTokenEnc, instagram: !!integ?.instagramTokenEnc, google: !!integ?.enableGoogle },
    })

    // ---------- FIX determinista (único permitido) ----------
    let fixed: Record<string, number> = {}
    if (applyFix && orphans > 0) {
      const r = await db.automationRun.updateMany({
        where: { status: 'running', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
        data: { status: 'failed', error: 'interrupted: marcado por Doctor (fix determinista)', finishedAt: new Date() },
      })
      fixed = { orphanRunsMarkedFailed: r.count }
    }

    const verdict = checks.some((c) => c.status === 'fail') ? 'critical' : checks.some((c) => c.status === 'warn') ? 'degraded' : 'healthy'
    return json({ version: APP_VERSION, generatedAt: new Date().toISOString(), verdict, organizationId: auth.orgId, checks, fixed })
  })
}
