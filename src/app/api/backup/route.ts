import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET  /api/backup — dump JSON de todos los datos de la organización (descarga).
 * POST /api/backup — restauración básica: { clients?, services?, templates? } del body.
 */

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const orgId = auth.orgId
    const [org, clients, services, templates, opportunities, reservations, quotes, transactions, automations, timelineEvents, savedViews, memories] =
      await Promise.all([
        db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true, plan: true, createdAt: true } }),
        db.client.findMany({ where: { organizationId: orgId } }),
        db.service.findMany({ where: { organizationId: orgId } }),
        db.template.findMany({ where: { organizationId: orgId } }),
        db.opportunity.findMany({ where: { organizationId: orgId } }),
        db.reservation.findMany({ where: { organizationId: orgId } }),
        db.quote.findMany({ where: { organizationId: orgId } }),
        db.transaction.findMany({ where: { organizationId: orgId } }),
        db.automation.findMany({ where: { organizationId: orgId } }),
        db.timelineEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 2000 }),
        db.savedView.findMany({ where: { organizationId: orgId } }),
        db.agentMemory.findMany({ where: { organizationId: orgId } }),
      ])

    await auditAndTimeline({ orgId, userId: auth.userId, action: 'exported', entity: 'backup', details: { clients: clients.length } })

    const payload = {
      app: 'CRM ALBRA',
      version: 1,
      exportedAt: new Date().toISOString(),
      organization: org,
      data: { clients, services, templates, opportunities, reservations, quotes, transactions, automations, timelineEvents, savedViews, memories },
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
}

const s = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const n = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Number(v) : fallback)

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as BackupBody
    const restored = { clients: 0, services: 0, templates: 0 }
    const skipped = { clients: 0, services: 0, templates: 0 }

    // Clients (dedupe por phone)
    for (const raw of Array.isArray(body.clients) ? body.clients.slice(0, 2000) : []) {
      const name = s(raw.name, 120)
      if (!name) {
        skipped.clients++
        continue
      }
      const phone = s(raw.phone, 40)
      if (phone && (await db.client.findFirst({ where: { organizationId: auth.orgId, phone }, select: { id: true } }))) {
        skipped.clients++
        continue
      }
      await db.client.create({
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
      restored.clients++
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
