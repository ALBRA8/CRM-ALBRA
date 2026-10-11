import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { handle } from '../../_lib/shared'
import { quoteDiscountAmount } from '../../_lib/quotes'
import { buildQuotePdf } from '../../_lib/pdf'

/**
 * GET /api/quotes/pdf?id=... — descarga la cotización en PDF.
 *
 * Motor PDF propio sin dependencias (src/app/api/_lib/pdf.ts): el detalle
 * vive en la UI y los totales se recalculan de la misma fuente (Quote +
 * QuoteItem) que el endpoint de detalle. Multi-tenant: solo cotizaciones de
 * la organización del usuario autenticado.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const id = req.nextUrl.searchParams.get('id')
    if (!id) throw new HttpError(400, 'Falta el parámetro id')

    const quote = await db.quote.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        items: { orderBy: { position: 'asc' } },
        client: { select: { name: true, email: true, phone: true, address: true } },
        opportunity: { select: { title: true } },
      },
    })
    if (!quote) throw new HttpError(404, 'Cotización no encontrada')

    const org = await db.organization.findUnique({
      where: { id: auth.orgId },
      select: { name: true },
    })

    const pdf = buildQuotePdf({
      number: quote.number,
      status: quote.status,
      currency: quote.currency,
      createdAt: quote.createdAt,
      validUntil: quote.validUntil,
      subtotal: quote.subtotal,
      discount: quoteDiscountAmount(quote),
      tax: quote.tax,
      total: quote.total,
      notes: quote.notes,
      orgName: org?.name ?? null,
      client: quote.client,
      opportunityTitle: quote.opportunity?.title ?? null,
      items: quote.items.map((it) => ({
        sku: it.sku,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.subtotal ?? it.quantity * it.unitPrice,
      })),
    })

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${quote.number}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  })
}
