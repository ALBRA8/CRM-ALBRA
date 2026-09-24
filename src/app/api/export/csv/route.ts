import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { buildCsv } from '@/lib/csv'
import { auditAndTimeline } from '@/lib/api-helpers'

/**
 * GET /api/export/csv?type=clients|services|quotes — CSV con BOM UTF-8.
 * Autenticación por header Bearer o ?token= (descargas directas desde <a>).
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = getAuth(req)
    if (!auth) return json({ error: 'Token de autorización requerido' }, { status: 401 })
    const type = new URL(req.url).searchParams.get('type') || 'clients'
    const orgId = auth.orgId

    let csv = ''
    let filename = `export_${type}_${new Date().toISOString().split('T')[0]}.csv`

    if (type === 'clients') {
      const clients = await db.client.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } })
      csv = buildCsv(
        ['name', 'phone', 'email', 'status', 'source', 'cedula', 'address', 'notes', 'lastContactAt', 'createdAt'],
        clients.map((c) => [c.name, c.phone || '', c.email || '', c.status, c.source || '', c.cedula || '', c.address || '', c.notes || '', c.lastContactAt?.toISOString() || '', c.createdAt.toISOString()])
      )
    } else if (type === 'services') {
      const services = await db.service.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } })
      csv = buildCsv(
        ['name', 'description', 'category', 'price', 'duration', 'unit', 'isActive'],
        services.map((s) => [s.name, s.description || '', s.category || '', s.price, s.duration ?? '', s.unit, s.isActive])
      )
    } else if (type === 'quotes') {
      const quotes = await db.quote.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { name: true } } },
      })
      csv = buildCsv(
        ['number', 'client', 'status', 'subtotal', 'tax', 'total', 'currency', 'createdAt'],
        quotes.map((q) => [q.number, q.client?.name || '', q.status, q.subtotal, q.tax, q.total, q.currency, q.createdAt.toISOString()])
      )
    } else {
      return json({ error: 'type debe ser clients | services | quotes' }, { status: 400 })
    }

    await auditAndTimeline({ orgId, userId: auth.userId, action: 'exported', entity: type, details: { type } })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  })
}
