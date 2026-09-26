import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { buildSimplePdf } from '@/lib/pdf'

/**
 * GET /api/reports/pdf?period=7d|30d|90d|1y|all — PDF del reporte (token por query o Bearer).
 * Sin pdfkit: generador PDF propio (src/lib/pdf.ts) — funciona en el bundler sin .afm externos.
 */

function dominantCurrency(currencies: (string | null | undefined)[]): string {
  const counts = new Map<string, number>()
  for (const c of currencies) counts.set(c || 'USD', (counts.get(c || 'USD') || 0) + 1)
  let best = 'USD'
  let bestN = 0
  for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n }
  return best
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = getAuth(req)
    if (!auth) return json({ error: 'Token de autorización requerido' }, { status: 401 })
    const period = new URL(req.url).searchParams.get('period') || '30d'
    const days: number | null = { '7d': 7, '30d': 30, month: 30, '90d': 90, quarter: 90, '1y': 365, year: 365, all: null }[period] ?? 30
    const from = days ? new Date(Date.now() - days * 86_400_000) : new Date(0)

    const [transactions, opportunities, clients] = await Promise.all([
      db.transaction.findMany({ where: { organizationId: auth.orgId, date: { gte: from } }, select: { type: true, amount: true, currency: true, category: true, date: true } }),
      db.opportunity.findMany({ where: { organizationId: auth.orgId, createdAt: { gte: from } }, select: { title: true, amount: true, status: true } }),
      db.client.findMany({ where: { organizationId: auth.orgId, createdAt: { gte: from } }, select: { name: true, source: true } }),
    ])

    // BUG DE IDIOMA (auditoría Antigravity, crítico #5): la BD guarda los tipos en
    // español ('ingreso'/'egreso', ver normalizeTxType). Filtrar en inglés daba $0.
    const income = transactions.filter((t) => t.type === 'ingreso').reduce((a, t) => a + t.amount, 0)
    const expenses = transactions.filter((t) => t.type === 'egreso').reduce((a, t) => a + t.amount, 0)
    const won = opportunities.filter((o) => o.status === 'won')
    const open = opportunities.filter((o) => o.status === 'open')

    // Moneda dominante de las transacciones del período (antes: MXN/USD fijo)
    const currency = dominantCurrency(transactions.map((t) => t.currency))
    const money = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)

    const lines = [
      { text: `Período: ${period} — generado ${new Date().toLocaleString('es-CO')}`, size: 10 },
      { text: '' },
      { text: 'Resumen financiero', size: 13, bold: true },
      { text: `Ingresos: ${money(income)}` },
      { text: `Egresos: ${money(expenses)}` },
      { text: `Balance: ${money(income - expenses)}` },
      { text: '' },
      { text: 'Embudo comercial', size: 13, bold: true },
      { text: `Clientes nuevos: ${clients.length}` },
      { text: `Oportunidades nuevas: ${opportunities.length} (abiertas: ${open.length})` },
      { text: `Ganadas: ${won.length} por ${money(won.reduce((a, o) => a + o.amount, 0))}` },
      { text: '' },
      { text: 'Últimas oportunidades del período', size: 13, bold: true },
      ...opportunities.slice(0, 12).map((o) => ({ text: `${o.title} — ${money(o.amount)} (${o.status})` })),
      { text: '' },
      { text: 'Clientes nuevos', size: 13, bold: true },
      ...clients.slice(0, 15).map((c) => ({ text: `${c.name}${c.source ? ` — fuente: ${c.source}` : ''}` })),
    ]

    const pdf = buildSimplePdf('Reporte CRM ALBRA', lines)
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="reporte_${period}_${new Date().toISOString().split('T')[0]}.pdf"`,
      },
    })
  })
}
