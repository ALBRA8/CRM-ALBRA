import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * GET /api/suggestions — Sugerencias IA del agente comercial.
 *
 * Reglas deterministas (+ enriquecimiento) con caché de 6h en AgentSuggestion:
 *  - follow_up: clientes activos/prospecto sin contacto > 14 días
 *  - opportunity: oportunidades abiertas estancadas (> 21 días o vencidas)
 *  - reengage: clientes inactivos con historial de negocio
 *
 * Respuesta: { suggestions: [{ client: {...}, priorityScore, reasons }], totalClients }
 * (shape consumido por dashboard-page.tsx y suggestions-panel.tsx).
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const FOLLOW_UP_DAYS = 14
const STALE_OPP_DAYS = 21

interface SuggestionClient {
  id: string
  name: string
  phone: string
  email?: string
  temperature: string
  score: number
  lastContactAt?: string | null
  daysSinceContact: number
  latestOpportunity?: { id: string; title: string; stage: string; estimatedValue: number } | null
  upcomingReservation?: { id: string; title: string; date: string } | null
}

interface Suggestion {
  client: SuggestionClient
  priorityScore: number
  reasons: string[]
}

function daysSince(date: Date | null): number {
  if (!date) return 9999
  return Math.floor((Date.now() - date.getTime()) / 86_400_000)
}

function temperatureFor(days: number, maxOpenAmount: number): string {
  if (maxOpenAmount >= 3000 && days <= 7) return 'Fuego'
  if ((maxOpenAmount >= 500 && days <= 14) || days <= 3) return 'Caliente'
  if (days <= 30) return 'Tibio'
  return 'Frio'
}

async function enrichClients(
  orgId: string,
  rows: Array<{ id: string; name: string; phone: string | null; email: string | null; lastContactAt: Date | null; createdAt: Date; status: string }>
): Promise<Suggestion[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [opps, reservations] = await Promise.all([
    db.opportunity.findMany({
      where: { organizationId: orgId, clientId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, clientId: true, title: true, amount: true, status: true, stageId: true },
    }),
    db.reservation.findMany({
      where: { organizationId: orgId, clientId: { in: ids }, status: 'scheduled', startsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, clientId: true, title: true, startsAt: true },
    }),
  ])
  const stageNames = new Map<string, string>()
  const stages = await db.pipelineStage.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } })
  stages.forEach((s) => stageNames.set(s.id, s.name))

  const out: Suggestion[] = []
  for (const row of rows) {
    const clientOpps = opps.filter((o) => o.clientId === row.id)
    const openOpps = clientOpps.filter((o) => o.status === 'open')
    const maxOpen = openOpps.reduce((m, o) => Math.max(m, o.amount), 0)
    const lastContact = row.lastContactAt || row.createdAt
    const days = daysSince(lastContact)
    const latest = clientOpps[0] || openOpps[0] || null
    const upcoming = reservations.find((r) => r.clientId === row.id) || null

    const client: SuggestionClient = {
      id: row.id,
      name: row.name,
      phone: row.phone || '',
      email: row.email || undefined,
      temperature: temperatureFor(days, maxOpen),
      score: Math.min(100, Math.round(maxOpen / 100) + Math.max(0, 40 - days)),
      lastContactAt: row.lastContactAt ? row.lastContactAt.toISOString() : null,
      daysSinceContact: Math.min(days, 999),
      latestOpportunity: latest
        ? { id: latest.id, title: latest.title, stage: stageNames.get(latest.stageId || '') || '—', estimatedValue: latest.amount }
        : null,
      upcomingReservation: upcoming ? { id: upcoming.id, title: upcoming.title, date: upcoming.startsAt.toISOString() } : null,
    }
    out.push({ client, priorityScore: 0, reasons: [] })
  }
  return out
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const orgId = auth.orgId
    const force = new URL(req.url).searchParams.get('refresh') === '1'

    // ---- Caché: sugerencias con menos de 6h se devuelven persistidas ----
    if (!force) {
      const recent = await db.agentSuggestion.findMany({
        where: { organizationId: orgId, status: 'new', createdAt: { gte: new Date(Date.now() - SIX_HOURS_MS) } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      if (recent.length > 0) {
        const clientIds = [...new Set(recent.map((s) => s.clientId).filter((v): v is string => !!v))]
        const clients = await db.client.findMany({
          where: { organizationId: orgId, id: { in: clientIds } },
          select: { id: true, name: true, phone: true, email: true, lastContactAt: true, createdAt: true, status: true },
        })
        const enriched = await enrichClients(orgId, clients)
        const byId = new Map(enriched.map((e) => [e.client.id, e]))
        const totalClients = await db.client.count({ where: { organizationId: orgId } })

        const suggestions: Suggestion[] = []
        for (const s of recent) {
          const base = s.clientId ? byId.get(s.clientId) : undefined
          if (!base) continue
          const priorityBase = s.priority === 'high' ? 80 : s.priority === 'medium' ? 50 : 25
          suggestions.push({
            client: base.client,
            priorityScore: priorityBase + Math.max(0, 30 - base.client.daysSinceContact),
            reasons: [s.title, s.description || ''].filter(Boolean),
          })
        }
        suggestions.sort((a, b) => b.priorityScore - a.priorityScore)
        return json({ suggestions, totalClients })
      }
    }

    // ---- Regeneración (reglas deterministas) ----
    const fourteenDaysAgo = new Date(Date.now() - FOLLOW_UP_DAYS * 86_400_000)
    const staleCutoff = new Date(Date.now() - STALE_OPP_DAYS * 86_400_000)

    const [candidates, staleOpps, inactiveWithHistory, totalClients] = await Promise.all([
      db.client.findMany({
        where: {
          organizationId: orgId,
          status: { in: ['active', 'prospect'] },
          OR: [{ lastContactAt: null, createdAt: { lt: fourteenDaysAgo } }, { lastContactAt: { lt: fourteenDaysAgo } }],
        },
        orderBy: { lastContactAt: 'asc' },
        take: 15,
        select: { id: true, name: true, phone: true, email: true, lastContactAt: true, createdAt: true, status: true },
      }),
      db.opportunity.findMany({
        where: {
          organizationId: orgId,
          status: 'open',
          OR: [{ createdAt: { lt: staleCutoff } }, { expectedCloseDate: { lt: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 15,
        select: { id: true, clientId: true, title: true, amount: true, createdAt: true, expectedCloseDate: true },
      }),
      db.client.findMany({
        where: { organizationId: orgId, status: 'inactive' },
        take: 15,
        select: { id: true, name: true, phone: true, email: true, lastContactAt: true, createdAt: true, status: true, _count: { select: { opportunities: true, transactions: true, histories: true } } },
      }),
      db.client.count({ where: { organizationId: orgId } }),
    ])

    const enriched = await enrichClients(orgId, candidates)
    const reasonsByClient = new Map<string, string[]>()

    for (const s of enriched) {
      const days = s.client.daysSinceContact
      const reasons = [
        days >= 999 ? 'Nunca ha sido contactado' : `${days} días sin contacto`,
        s.client.temperature === 'Caliente' || s.client.temperature === 'Fuego'
          ? `Cliente ${s.client.temperature.toLowerCase()} — prioriza el contacto`
          : 'Candidato a seguimiento',
      ]
      reasonsByClient.set(s.client.id, reasons)
    }

    const staleOppClientIds = new Set(staleOpps.map((o) => o.clientId).filter((v): v is string => !!v))
    const staleClients = await db.client.findMany({
      where: { organizationId: orgId, id: { in: [...staleOppClientIds] } },
      select: { id: true, name: true, phone: true, email: true, lastContactAt: true, createdAt: true, status: true },
    })
    const enrichedStale = await enrichClients(orgId, staleClients)

    const reengageClients = inactiveWithHistory.filter((c) => c._count.opportunities + c._count.transactions + c._count.histories > 0)

    // ---- Persistir (reemplaza las 'new' anteriores) ----
    await db.agentSuggestion.deleteMany({ where: { organizationId: orgId, status: 'new' } })

    const toCreate: Array<{
      organizationId: string
      clientId: string | null
      type: string
      title: string
      description: string
      priority: string
    }> = []

    for (const s of enriched) {
      toCreate.push({
        organizationId: orgId,
        clientId: s.client.id,
        type: 'follow_up',
        title: `Seguimiento a ${s.client.name}`,
        description: `${s.client.daysSinceContact >= 999 ? 'Sin contacto registrado' : `${s.client.daysSinceContact} días sin contacto`} — temperature ${s.client.temperature}`,
        priority: s.client.daysSinceContact > 30 ? 'high' : 'medium',
      })
    }
    for (const s of enrichedStale) {
      const opp = staleOpps.find((o) => o.clientId === s.client.id)
      if (!opp) continue
      const daysOpen = daysSince(opp.createdAt)
      toCreate.push({
        organizationId: orgId,
        clientId: s.client.id,
        type: 'opportunity',
        title: `Oportunidad estancada: ${opp.title}`,
        description: `Abierta desde hace ${daysOpen} días por ${opp.amount.toFixed(0)} USD — merece un empujón o cierre`,
        priority: daysOpen > 45 ? 'high' : 'medium',
      })
    }
    for (const c of reengageClients) {
      toCreate.push({
        organizationId: orgId,
        clientId: c.id,
        type: 'reengage',
        title: `Reactivar a ${c.name}`,
        description: 'Cliente inactivo con historial de negocio — candidato a promoción o re-engagement',
        priority: 'low',
      })
    }

    if (toCreate.length > 0) {
      await db.agentSuggestion.createMany({ data: toCreate.slice(0, 40) })
    }

    // ---- Construir respuesta enriquecida ----
    const persisted = await db.agentSuggestion.findMany({
      where: { organizationId: orgId, status: 'new' },
      orderBy: { createdAt: 'desc' },
      take: 40,
    })

    const allClientIds = [...new Set(persisted.map((s) => s.clientId).filter((v): v is string => !!v))]
    const allClients = await db.client.findMany({
      where: { organizationId: orgId, id: { in: allClientIds } },
      select: { id: true, name: true, phone: true, email: true, lastContactAt: true, createdAt: true, status: true },
    })
    const enrichedAll = await enrichClients(orgId, allClients)
    const byId = new Map(enrichedAll.map((e) => [e.client.id, e]))

    const suggestions: Suggestion[] = []
    for (const s of persisted) {
      const base = s.clientId ? byId.get(s.clientId) : undefined
      if (!base) continue
      const priorityBase = s.priority === 'high' ? 80 : s.priority === 'medium' ? 50 : 25
      const reasons = s.type === 'opportunity' || s.type === 'reengage' ? [s.title, s.description || ''] : (reasonsByClient.get(s.clientId || '') || [s.title])
      suggestions.push({
        client: base.client,
        priorityScore: priorityBase + Math.max(0, 30 - base.client.daysSinceContact),
        reasons: reasons.filter(Boolean),
      })
    }
    suggestions.sort((a, b) => b.priorityScore - a.priorityScore)

    return json({ suggestions, totalClients })
  })
}
