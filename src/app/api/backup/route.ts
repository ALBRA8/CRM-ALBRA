import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requirePermission, HttpError } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET  /api/backup — dump JSON de todos los datos de la organización (descarga).
 *   Incluye quoteItems para que el JSON sea autocontenido (restauración fiel).
 * POST /api/backup — restauración del JSON exportado.
 *
 * (segunda reparación §2.E) CONSISTENCIA:
 *  - El GET lee TODAS las tablas dentro de una transacción: el JSON refleja un
 *    snapshot consistente aunque haya escrituras concurrentes (SQLite sirve
 *    lecturas de un solo snapshot dentro de la transacción).
 *  - El POST restaura DENTRO de una única transacción: o se restaura todo, o
 *    nada (jamás un restore parcial por un crash a mitad). Los números de
 *    cotización que colisionen con los existentes de la org se sufijan (sin
 *    borrar nada) para respetar la unicidad por organización.
 */

export async function GET(req: NextRequest) {
  return handle(async () => {
    // Fase 2 RBAC: el backup contiene TODOS los datos de la org → solo owner/admin
    const auth = await requirePermission(req, 'export.data')
    const orgId = auth.orgId
    // Snapshot consistente: todas las lecturas dentro de UNA transacción
    // (timeout ampliado: el dump completo puede tardar más que el default 5 s).
    // La auditoría se registra FUERA: no forma parte del snapshot de datos.
    const payload = await db.$transaction(async (tx) => {
      const [org, clients, services, templates, opportunities, reservations, quotes, quoteItems, transactions, automations, timelineEvents, savedViews, memories] =
        await Promise.all([
          tx.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true, plan: true, createdAt: true } }),
          tx.client.findMany({ where: { organizationId: orgId } }),
          tx.service.findMany({ where: { organizationId: orgId } }),
          tx.template.findMany({ where: { organizationId: orgId } }),
          tx.opportunity.findMany({ where: { organizationId: orgId } }),
          tx.reservation.findMany({ where: { organizationId: orgId } }),
          tx.quote.findMany({ where: { organizationId: orgId } }),
          tx.quoteItem.findMany({ where: { quote: { organizationId: orgId } } }),
          tx.transaction.findMany({ where: { organizationId: orgId } }),
          tx.automation.findMany({ where: { organizationId: orgId } }),
          tx.timelineEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 2000 }),
          tx.savedView.findMany({ where: { organizationId: orgId } }),
          tx.agentMemory.findMany({ where: { organizationId: orgId } }),
        ])
      return {
        app: 'CRM ALBRA',
        version: 3,
        exportedAt: new Date().toISOString(),
        organization: org,
        data: { clients, services, templates, opportunities, reservations, quotes, quoteItems, transactions, automations, timelineEvents, savedViews, memories },
      }
    }, { maxWait: 5_000, timeout: 60_000 })

    await auditAndTimeline({ orgId, userId: auth.userId, action: 'exported', entity: 'backup', details: { clients: (payload.data as { clients: unknown[] }).clients.length } })

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

// (tercera reparación 6.A) Tope EFECTIVO del body de restauración:
// el límite NO puede depender de Content-Length (una petición chunked o sin
// cabecera lo evadía y req.json() cargaba el body COMPLETO en memoria).
// Se lee el STREAM por chunks con corte duro en MAX_BACKUP_BYTES: el cuerpo se
// descarta en cuanto se supera el tope (sin acumularlo), haya o no cabecera.
const MAX_BACKUP_BYTES = 25_000_000

async function readJsonBodyWithLimit(req: NextRequest, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  // Rechazo rápido cuando la cabecera declara un tamaño mayor (ahorra lectura)
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, tooLarge: true }
  }
  const reader = req.body?.getReader()
  if (!reader) {
    // Sin stream legible no hay backup verificable: rechazo (fail-closed)
    return { ok: false, tooLarge: true }
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value?.byteLength ?? 0
      if (total > maxBytes) {
        try { await reader.cancel('backup demasiado grande') } catch {}
        return { ok: false, tooLarge: true }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, tooLarge: false } // stream roto/abortado → body inválido (400), no un exceso de tamaño
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(merged) }
}

/**
 * (tercera reparación 6.A) Validación de ESTRUCTURA y VERSIÓN del backup ANTES
 * de tocar la base de datos: un JSON corrupto, de otra aplicación o de una
 * versión futura se rechaza con 400 (jamás se inicia una restauración parcial).
 */
function validateBackupEnvelope(parsed: unknown): { ok: true; body: BackupBody } | { ok: false; message: string } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'Backup inválido: se esperaba un objeto JSON' }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.app !== 'CRM ALBRA') {
    return { ok: false, message: 'Backup inválido: no es un backup de CRM ALBRA (campo app ausente o incorrecto)' }
  }
  const version = Number(obj.version)
  if (!Number.isFinite(version) || version < 1 || version > 3) {
    return { ok: false, message: 'Backup con versión no soportada (se admiten versiones 1 a 3)' }
  }
  const data = obj.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, message: 'Backup inválido: falta el objeto data' }
  }
  const collections = ['clients', 'services', 'templates', 'opportunities', 'reservations', 'quotes', 'quoteItems', 'transactions'] as const
  for (const key of collections) {
    const val = (data as Record<string, unknown>)[key]
    if (val !== undefined && !Array.isArray(val)) {
      return { ok: false, message: `Backup inválido: la colección "${key}" debe ser un arreglo` }
    }
  }
  return { ok: true, body: data as BackupBody }
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    // Fase 2 RBAC: restaurar datos masivamente es owner/admin
    const auth = await requirePermission(req, 'export.data')
    // (tercera reparación 6.A) Tope EFECTIVO por lectura de stream (25 MB):
    // cubre Content-Length, transferencia chunked y peticiones SIN cabecera.
    // El body se descarta en cuanto se supera el tope → 413 sin agotar memoria.
    const bodyRead = await readJsonBodyWithLimit(req, MAX_BACKUP_BYTES)
    if (!bodyRead.ok) {
      throw new HttpError(
        bodyRead.tooLarge ? 413 : 400,
        bodyRead.tooLarge ? 'Backup demasiado grande (máximo 25 MB)' : 'No se pudo leer el cuerpo de la restauración (stream inválido o interrumpido)'
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(bodyRead.text)
    } catch {
      throw new HttpError(400, 'Backup inválido: el cuerpo no es JSON válido')
    }
    const envelope = validateBackupEnvelope(parsed)
    if (!envelope.ok) {
      throw new HttpError(400, envelope.message)
    }
    const body = envelope.body
    const restored = { clients: 0, services: 0, templates: 0, opportunities: 0, reservations: 0, quotes: 0, quoteItems: 0, transactions: 0 }
    const skipped = { clients: 0, services: 0, templates: 0, opportunities: 0, reservations: 0, quotes: 0, quoteItems: 0, transactions: 0 }

    // Mapa teléfono(sinnúmero)→id actual y oldId→newId para re-vincular
    // oportunidades/cotizaciones/reservas/transacciones al cliente correcto.
    // (segunda reparación §2.E) TODA la restauración corre dentro de UNA
    // transacción: o se restaura todo o nada — jamás un restore parcial por
    // un crash a mitad ni registros huérfanos a mitad de import.
    // (tercera reparación 6.A) La AUDITORÍA va FUERA de la transacción:
    // auditAndTimeline escribe por la conexión global y, dentro de la
    // transacción interactiva (que retiene el lock de escritura de SQLite),
    // se bloqueaba en deadlock (defecto de fase 2 detectado por la batería).
    // Además: si la restauración se revierte, no queda auditoría de un hecho
    // que no ocurrió. El operatorio del restore queda auditado SOLO si existe.
    const result = await db.$transaction(async (tx) => {
    const orgClients = await tx.client.findMany({ where: { organizationId: auth.orgId }, select: { id: true, phone: true } })
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
      const created = await tx.client.create({
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
      await tx.service.create({
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
      await tx.template.create({
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
      const created = await tx.opportunity.create({
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
      await tx.reservation.create({
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
      let number = s(raw.number, 40) || `BK-${Date.now()}-${restored.quotes + 1}`
      // (segunda reparación §2.E) La unicidad (organizationId, number) es ley:
      // si el número ya existe en la org (p. ej. restore del mismo backup dos
      // veces), se sufija en lugar de abortar todo el import. No se borra ni
      // sobrescribe ningún registro existente.
      if (await tx.quote.findFirst({ where: { organizationId: auth.orgId, number }, select: { id: true } })) {
        number = `${number.slice(0, 32)}-R${Date.now().toString(36).slice(-4)}${restored.quotes}`
      }
      const created = await tx.quote.create({
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
      await tx.quoteItem.create({
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
      await tx.transaction.create({
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

    return { success: true, restored, skipped }
    }, { maxWait: 5_000, timeout: 120_000 }) // fin db.$transaction — todo o nada

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'imported',
      entity: 'backup',
      details: { restored: result.restored, skipped: result.skipped },
    })

    return json(result)
  })
}
