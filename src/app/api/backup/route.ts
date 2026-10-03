import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET  /api/backup — dump JSON de todos los datos de la organización (descarga).
 *   Incluye quoteItems para que el JSON sea autocontenido (restauración fiel).
 * POST /api/backup — restauración best-effort del JSON exportado:
 *   clients, services, templates, opportunities, reservations, quotes (+items)
 *   y transactions. Las entidades se re-vinculan al cliente por teléfono del
 *   propio backup (mapa oldId→newId). Nota: las ETAPAS del pipeline no viajan
 *   en el backup → las oportunidades quedan sin stageId (posición del kanban
 *   no restaurable desde JSON). Para recuperación total ante desastres,
 *   reemplazar los archivos físicos db/custom.db y .wa-auth/.
 */

export async function GET(req: NextRequest) {
  return handle(async () => {
    // Fase 2 RBAC: el backup contiene TODOS los datos de la org → solo owner/admin
    const auth = requirePermission(req, 'export.data')
    const orgId = auth.orgId
    const [org, clients, services, templates, opportunities, reservations, quotes, quoteItems, transactions, automations, timelineEvents, savedViews, memories] =
      await Promise.all([
        db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true, plan: true, createdAt: true } }),
        db.client.findMany({ where: { organizationId: orgId } }),
        db.service.findMany({ where: { organizationId: orgId } }),
        db.template.findMany({ where: { organizationId: orgId } }),
        db.opportunity.findMany({ where: { organizationId: orgId } }),
        db.reservation.findMany({ where: { organizationId: orgId } }),
        db.quote.findMany({ where: { organizationId: orgId } }),
        db.quoteItem.findMany({ where: { quote: { organizationId: orgId } } }),
        db.transaction.findMany({ where: { organizationId: orgId } }),
        db.automation.findMany({ where: { organizationId: orgId } }),
        db.timelineEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 2000 }),
        db.savedView.findMany({ where: { organizationId: orgId } }),
        db.agentMemory.findMany({ where: { organizationId: orgId } }),
      ])

    await auditAndTimeline({ orgId, userId: auth.userId, action: 'exported', entity: 'backup', details: { clients: clients.length } })

    const payload = {
      app: 'CRM ALBRA',
      version: 2,
      exportedAt: new Date().toISOString(),
      organization: org,
      data: { clients, services, templates, opportunities, reservations, quotes, quoteItems, transactions, automations, timelineEvents, savedViews, memories },
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="crm-albra-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  })
}

interface BackupBody {
  clients?: Array<Record<string, unknown>>
  services?: Array<Record<string, unknown>>
  templates?: Array<Record<string, unknown>>
  opportunities?: Array<Record<string, unknown>>
  reservations?: Array<Record<string, unknown>>
  quotes?: Array<Record<string, unknown>>
  quoteItems?: Array<Record<string, unknown>>
  transactions?: Array<Record<string, unknown>>
}

const s = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const n = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const d = (v: unknown): Date | null => {
  if (!v) return null
  const t = new Date(String(v))
  return Number.isNaN(t.getTime()) ? null : t
}
const digits = (v: unknown): string => String(v ?? '').replace(/\D+/g, '')

export async function POST(req: NextRequest) {
  return handle(async () => {
    // Fase 2 RBAC: restaurar datos masivamente es owner/admin
    const auth = requirePermission(req, 'export.data')
    const body = (await req.json().catch(() => ({}))) as BackupBody
    const restored = { clients: 0, services: 0, templates: 0, opportunities: 0, reservations: 0, quotes: 0, quoteItems: 0, transactions: 0 }
    const skipped = { clients: 0, services: 0, templates: 0, opportunities: 0, reservations: 0, quotes: 0, quoteItems: 0, transactions: 0 }

    // Mapa teléfono(sinnúmero)→id actual y oldId→newId para re-vincular
    // oportunidades/cotizaciones/reservas/transacciones al cliente correcto.
    const orgClients = await db.client.findMany({ where: { organizationId: auth.orgId }, select: { id: true, phone: true } })
    const clientByPhone = new Map<string, string>()
    for (const c of orgClients) if (c.phone) clientByPhone.set(digits(c.phone), c.id)
    const oldToNewClient: Record<string, string> = {}

    // Clients (dedupe por phone)
    for (const raw of Array.isArray(body.clients) ? body.clients.slice(0, 2000) : []) {
      const name = s(raw.name, 120)
      if (!name) {
        skipped.clients++
        continue
      }
      const phone = s(raw.phone, 40)
      const ph = digits(phone)
      const existingId = ph ? clientByPhone.get(ph) ?? null : null
      if (existingId) {
        // Ya existe: no se duplica, pero el backup queda mapeado a ese cliente
        if (typeof raw.id === 'string') oldToNewClient[raw.id] = existingId
        skipped.clients++
        continue
      }
      const created = await db.client.create({
        data: {
          organizationId: auth.orgId,
          name,
          phone,
          email: s(raw.email, 160),
          cedula: s(raw.cedula, 60),
          address: s(raw.address, 300),
          notes: s(raw.notes, 2000),
          status: ['prospect', 'active', 'inactive'].includes(String(raw.status)) ? String(raw.status) : 'prospect',
          source: s(raw.source, 40) || 'backup',
        },
      })
      if (phone) clientByPhone.set(ph, created.id)
      if (typeof raw.id === 'string') oldToNewClient[raw.id] = created.id
      restored.clients++
    }

    /** oldId del backup → id del cliente actual (null si no se puede mapear) */
    const mapClient = (raw: Record<string, unknown>): string | null => {
      const old = typeof raw?.clientId === 'string' ? raw.clientId : null
      return old ? (oldToNewClient[old] ?? null) : null
    }

    // Services
    for (const raw of Array.isArray(body.services) ? body.services.slice(0, 2000) : []) {
      const name = s(raw.name, 160)
      if (!name) {
        skipped.services++
        continue
      }
      await db.service.create({
        data: {
          organizationId: auth.orgId,
          name,
          description: s(raw.description, 1000),
          category: s(raw.category, 80),
          price: n(raw.price),
          duration: raw.duration ? Math.round(n(raw.duration)) : null,
          unit: s(raw.unit, 40) || 'unidad',
        },
      })
      restored.services++
    }

    // Templates
    for (const raw of Array.isArray(body.templates) ? body.templates.slice(0, 500) : []) {
      const name = s(raw.name, 120)
      const bodyText = s(raw.body ?? raw.content, 5000)
      if (!name || !bodyText) {
        skipped.templates++
        continue
      }
      await db.template.create({
        data: {
          organizationId: auth.orgId,
          name,
          channel: s(raw.channel, 30) || 'generic',
          subject: s(raw.subject, 200),
          body: bodyText,
          variables: s(raw.variables, 500),
          category: s(raw.category, 60) || 'seguimiento',
        },
      })
      restored.templates++
    }

    // Opportunities (FIX auditoría pre-venta #3: ya no se pierde el embudo)
    const oldToNewOpportunity: Record<string, string> = {}
    for (const raw of Array.isArray(body.opportunities) ? body.opportunities.slice(0, 5000) : []) {
      const title = s(raw.title, 160)
      if (!title) {
        skipped.opportunities++
        continue
      }
      const created = await db.opportunity.create({
        data: {
          organizationId: auth.orgId,
          title,
          clientId: mapClient(raw),
          // stageId: las etapas del pipeline no viajan en el backup JSON
          amount: n(raw.amount),
          currency: s(raw.currency, 8) || 'USD',
          probability: Number.isFinite(Number(raw.probability)) ? Number(raw.probability) : null,
          expectedCloseDate: d(raw.expectedCloseDate),
          status: ['open', 'won', 'lost'].includes(String(raw.status)) ? String(raw.status) : 'open',
          closedAt: d(raw.closedAt),
          notes: s(raw.notes, 2000),
          source: s(raw.source, 40) || 'backup',
        },
      })
      if (typeof raw.id === 'string') oldToNewOpportunity[raw.id] = created.id
      restored.opportunities++
    }

    // Reservations (calendario)
    for (const raw of Array.isArray(body.reservations) ? body.reservations.slice(0, 5000) : []) {
      const title = s(raw.title, 160)
      const startsAt = d(raw.startsAt)
      if (!title || !startsAt) {
        skipped.reservations++
        continue
      }
      await db.reservation.create({
        data: {
          organizationId: auth.orgId,
          title,
          clientId: mapClient(raw),
          description: s(raw.description, 1000),
          startsAt,
          endsAt: d(raw.endsAt),
          status: ['scheduled', 'completed', 'cancelled'].includes(String(raw.status)) ? String(raw.status) : 'scheduled',
          location: s(raw.location, 200),
        },
      })
      restored.reservations++
    }

    // Quotes + items (FIX auditoría pre-venta #3: ya no se pierden las cotizaciones)
    const oldToNewQuote: Record<string, string> = {}
    for (const raw of Array.isArray(body.quotes) ? body.quotes.slice(0, 5000) : []) {
      const number = s(raw.number, 40) || `BK-${Date.now()}-${restored.quotes + 1}`
      const created = await db.quote.create({
        data: {
          organizationId: auth.orgId,
          number,
          clientId: mapClient(raw),
          opportunityId: typeof raw.opportunityId === 'string' ? (oldToNewOpportunity[raw.opportunityId] ?? null) : null,
          subtotal: n(raw.subtotal),
          tax: n(raw.tax),
          total: n(raw.total),
          currency: s(raw.currency, 8) || 'USD',
          status: ['draft', 'sent', 'accepted', 'rejected', 'expired'].includes(String(raw.status)) ? String(raw.status) : 'draft',
          validUntil: d(raw.validUntil),
          notes: s(raw.notes, 2000),
        },
      })
      if (typeof raw.id === 'string') oldToNewQuote[raw.id] = created.id
      restored.quotes++
    }

    for (const raw of Array.isArray(body.quoteItems) ? body.quoteItems.slice(0, 20000) : []) {
      const newQuoteId = typeof raw.quoteId === 'string' ? (oldToNewQuote[raw.quoteId] ?? null) : null
      const description = s(raw.description, 300)
      if (!newQuoteId || !description) {
        skipped.quoteItems++
        continue
      }
      await db.quoteItem.create({
        data: {
          quoteId: newQuoteId,
          organizationId: auth.orgId,
          sku: s(raw.sku, 80),
          description,
          quantity: Math.max(1, Math.round(n(raw.quantity, 1))),
          unitPrice: n(raw.unitPrice),
          subtotal: n(raw.subtotal),
          position: Math.round(n(raw.position)),
        },
      })
      restored.quoteItems++
    }

    // Transactions (historial de dinero)
    for (const raw of Array.isArray(body.transactions) ? body.transactions.slice(0, 5000) : []) {
      const date = d(raw.date)
      await db.transaction.create({
        data: {
          organizationId: auth.orgId,
          type: String(raw.type) === 'expense' ? 'expense' : 'income',
          category: s(raw.category, 80),
          description: s(raw.description, 300),
          amount: n(raw.amount),
          currency: s(raw.currency, 8) || 'USD',
          date: date ?? new Date(),
          clientId: mapClient(raw),
          quoteId: typeof raw.quoteId === 'string' ? (oldToNewQuote[raw.quoteId] ?? null) : null,
          method: s(raw.method, 40),
        },
      })
      restored.transactions++
    }

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'imported',
      entity: 'backup',
      details: { restored, skipped },
    })

    return json({ success: true, restored, skipped })
  })
}
