import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { db } from '@/lib/db'
import PDFDocument from 'pdfkit'

export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'quotes', 'read')
  if (perm instanceof NextResponse) return perm
  const { userId } = perm

  const { searchParams } = new URL(request.url)
  const quoteId = searchParams.get('id')

  if (!quoteId) {
    return NextResponse.json({ error: 'ID de cotización requerido' }, { status: 400 })
  }

  try {
    const quote = await db.quote.findFirst({
      where: { id: quoteId, userId },
      include: {
        client: true,
        opportunity: true,
        items: { orderBy: { id: 'asc' } },
      },
    })

    if (!quote) {
      return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    }

    const user = await db.user.findUnique({ where: { id: userId } })
    const companyName = user?.company || 'CRM ALBRA'

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 60, left: 55, right: 55 } })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))

    const fmt = (v: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(v)
    const emerald = '#059669'
    const dark = '#1e293b'
    const gray = '#64748b'
    const lightBg = '#f0fdf4'

    // --- HEADER ---
    // Company name
    doc.fontSize(22).fillColor(emerald).font('Helvetica-Bold').text(companyName, 55, 50)
    doc.fontSize(10).fillColor(gray).font('Helvetica').text('Cotización', 55, 78)

    // Quote number and date on the right
    doc.fontSize(12).fillColor(dark).font('Helvetica-Bold').text(quote.quoteNumber, 400, 50, { align: 'right', width: 150 })
    doc.fontSize(9).fillColor(gray).font('Helvetica')
      .text(`Fecha: ${new Date(quote.createdAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}`, 400, 68, { align: 'right', width: 150 })
    if (quote.validUntil) {
      doc.text(`Válida hasta: ${new Date(quote.validUntil).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}`, 400, 82, { align: 'right', width: 150 })
    }

    // Status badge
    const statusLabels: Record<string, string> = { draft: 'BORRADOR', sent: 'ENVIADA', accepted: 'ACEPTADA', rejected: 'RECHAZADA', expired: 'EXPIRADA' }
    const statusColors: Record<string, string> = { draft: '#94a3b8', sent: '#0ea5e9', accepted: '#059669', rejected: '#dc2626', expired: '#f59e0b' }
    const statusLabel = statusLabels[quote.status] ?? quote.status.toUpperCase()
    const statusColor = statusColors[quote.status] ?? gray
    doc.rect(400, 100, 150, 20).fill(statusColor)
    doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold').text(statusLabel, 400, 105, { align: 'center', width: 150 })

    // Separator
    doc.moveTo(55, 130).lineTo(doc.page.width - 55, 130).strokeColor('#e2e8f0').lineWidth(1).stroke()

    // --- FROM / TO ---
    doc.fontSize(8).fillColor(gray).font('Helvetica-Bold').text('DE', 55, 140)
    doc.fontSize(11).fillColor(dark).font('Helvetica-Bold').text(companyName, 55, 153)
    if (user?.email) {
      doc.fontSize(9).fillColor(gray).font('Helvetica').text(user.email, 55, 168)
    }

    doc.fontSize(8).fillColor(gray).font('Helvetica-Bold').text('PARA', 320, 140)
    doc.fontSize(11).fillColor(dark).font('Helvetica-Bold').text(quote.client.name, 320, 153)
    if (quote.client.company) {
      doc.fontSize(9).fillColor(gray).font('Helvetica').text(quote.client.company, 320, 168)
    }
    if (quote.client.email) {
      doc.fontSize(9).fillColor(gray).font('Helvetica').text(quote.client.email, 320, quote.client.company ? 181 : 168)
    }
    if (quote.client.phone) {
      doc.fontSize(9).fillColor(gray).font('Helvetica').text(`Tel: ${quote.client.phone}`, 320, quote.client.email ? 194 : 181)
    }

    // Separator
    let sepY = 215
    doc.moveTo(55, sepY).lineTo(doc.page.width - 55, sepY).strokeColor('#e2e8f0').stroke()

    // --- ITEMS TABLE ---
    const tableTop = sepY + 10
    const colSku = 55
    const colDesc = 120
    const colQty = 320
    const colPrice = 390
    const colSub = 470
    const rowH = 24

    // Table header
    doc.rect(55, tableTop, doc.page.width - 110, rowH).fill(emerald)
    doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
    doc.text('SKU', colSku + 8, tableTop + 7)
    doc.text('DESCRIPCIÓN', colDesc, tableTop + 7)
    doc.text('CANT.', colQty, tableTop + 7, { width: 60, align: 'center' })
    doc.text('PRECIO UNIT.', colPrice, tableTop + 7, { width: 80, align: 'right' })
    doc.text('SUBTOTAL', colSub, tableTop + 7, { width: 80, align: 'right' })

    let rowY = tableTop + rowH

    quote.items.forEach((item, i) => {
      // Check if we need a new page
      if (rowY > doc.page.height - 120) {
        doc.addPage()
        rowY = 50
      }

      if (i % 2 === 0) {
        doc.rect(55, rowY, doc.page.width - 110, rowH).fill('#f8fafc')
      }

      doc.fontSize(9).fillColor(dark).font('Helvetica')
      doc.text(item.sku || '—', colSku + 8, rowY + 7, { width: 60 })
      doc.text(item.description, colDesc, rowY + 7, { width: 195 })
      doc.text(String(item.quantity), colQty, rowY + 7, { width: 60, align: 'center' })
      doc.text(fmt(item.unitPrice), colPrice, rowY + 7, { width: 80, align: 'right' })
      doc.font('Helvetica-Bold').text(fmt(item.subtotal), colSub, rowY + 7, { width: 80, align: 'right' })
      doc.font('Helvetica')
      rowY += rowH
    })

    // Bottom border
    doc.moveTo(55, rowY).lineTo(doc.page.width - 55, rowY).strokeColor('#e2e8f0').stroke()
    rowY += 15

    // --- TOTALS ---
    const totalsX = 380
    const valuesX = 470

    doc.fontSize(9).fillColor(gray).font('Helvetica').text('Subtotal', totalsX, rowY)
    doc.text(fmt(quote.subtotal), valuesX, rowY, { width: 80, align: 'right' })
    rowY += 18

    if (quote.discount > 0) {
      doc.fillColor('#dc2626').text('Descuento', totalsX, rowY)
      doc.text(`-${fmt(quote.discount)}`, valuesX, rowY, { width: 80, align: 'right' })
      rowY += 18
    }

    doc.fillColor(gray).text('IVA (16%)', totalsX, rowY)
    doc.text(fmt(quote.tax), valuesX, rowY, { width: 80, align: 'right' })
    rowY += 5

    doc.moveTo(totalsX, rowY + 12).lineTo(doc.page.width - 55, rowY + 12).strokeColor('#e2e8f0').stroke()
    rowY += 18

    doc.fontSize(14).fillColor(dark).font('Helvetica-Bold').text('TOTAL', totalsX, rowY)
    doc.fillColor(emerald).text(fmt(quote.total), valuesX, rowY, { width: 80, align: 'right' })
    rowY += 30

    // --- NOTES ---
    if (quote.notes) {
      if (rowY > doc.page.height - 100) doc.addPage()
      doc.fontSize(8).fillColor(gray).font('Helvetica-Bold').text('NOTAS', 55, rowY)
      doc.fontSize(9).fillColor(dark).font('Helvetica').text(quote.notes, 55, rowY + 14, { width: doc.page.width - 110 })
      rowY += 40
    }

    // --- FOOTER ---
    const footerY = doc.page.height - 45
    doc.moveTo(55, footerY).lineTo(doc.page.width - 55, footerY).strokeColor('#e2e8f0').stroke()
    doc.fontSize(7).fillColor(gray).font('Helvetica')
      .text(`${companyName} · Cotización ${quote.quoteNumber} · Generada por CRM ALBRA`, 55, footerY + 8, { align: 'center', width: doc.page.width - 110 })

    doc.end()

    const pdfBuffer = Buffer.concat(chunks)

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${quote.quoteNumber}.pdf"`,
      },
    })
  } catch (error) {
    console.error('Quote PDF generation error:', error)
    return NextResponse.json({ error: 'Error al generar PDF de cotización' }, { status: 500 })
  }
}
