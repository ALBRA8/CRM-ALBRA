import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { db } from '@/lib/db'
import PDFDocument from 'pdfkit'

export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'reports', 'read')
  if (perm instanceof NextResponse) return perm
  const { userId } = perm

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || '30d'

  const now = new Date()
  let startDate: Date
  let periodLabel: string
  switch (period) {
    case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); periodLabel = '7 dias'; break
    case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); periodLabel = '90 dias'; break
    case '1y': startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); periodLabel = '1 ano'; break
    case 'all': startDate = new Date(0); periodLabel = 'Todo el periodo'; break
    default: startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); periodLabel = '30 dias'; break
  }

  try {
    // Fetch user info
    const user = await db.user.findUnique({ where: { id: userId } })
    const companyName = user?.company || 'CRM ALBRA'

    // Pipeline data
    const stages = await db.pipelineStage.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
      include: { opportunities: { select: { estimatedValue: true } } },
    })

    // Revenue data
    const incomeTransactions = await db.transaction.findMany({
      where: { userId, type: 'ingreso', date: { gte: startDate } },
    })
    const expenseTransactions = await db.transaction.findMany({
      where: { userId, type: { in: ['egreso', 'compra_inventario'] }, date: { gte: startDate } },
    })

    // Clients
    const newClients = await db.client.count({ where: { userId, createdAt: { gte: startDate } } })
    const totalClients = await db.client.count({ where: { userId } })

    // Opportunities
    const newOpportunities = await db.opportunity.count({ where: { userId, createdAt: { gte: startDate } } })
    const closedOpportunities = await db.opportunity.findMany({
      where: { userId, closedAt: { not: null, gte: startDate } },
      include: { stage: true },
    })

    // Top clients
    const clients = await db.client.findMany({
      where: { userId },
      include: { opportunities: { select: { estimatedValue: true } } },
    })
    const topClients = clients
      .map(c => ({ name: c.name, totalValue: c.opportunities.reduce((a, o) => a + o.estimatedValue, 0) }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10)

    const totalRevenue = incomeTransactions.reduce((a, t) => a + t.amount, 0)
    const totalExpenses = expenseTransactions.reduce((a, t) => a + t.amount, 0)
    const profit = totalRevenue - totalExpenses

    // Build PDF
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 } })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))

    // Wait for the document to finish writing before sending the response
    const pdfFinished: Promise<void> = new Promise((resolve, reject) => {
      doc.on('end', resolve)
      doc.on('error', reject)
    })

    const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v)
    const blue = '#059669'
    const dark = '#1e293b'
    const gray = '#64748b'
    const lightBg = '#f0fdf4'

    // --- COVER ---
    doc.rect(0, 0, doc.page.width, 200).fill(blue)
    doc.fontSize(28).fillColor('#ffffff').text(companyName, 50, 60, { align: 'center' })
    doc.fontSize(16).fillColor('#d1fae5').text('Reporte de Negocio', 50, 100, { align: 'center' })
    doc.fontSize(11).fillColor('#a7f3d0').text(`Periodo: ${periodLabel}`, 50, 130, { align: 'center' })
    doc.fontSize(10).fillColor('#a7f3d0').text(`Generado: ${now.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}`, 50, 150, { align: 'center' })

    doc.moveDown(6)

    // --- SUMMARY KPIs ---
    doc.fontSize(18).fillColor(dark).text('Resumen Ejecutivo', { underline: false })
    doc.moveDown(0.3)
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#e2e8f0')
    doc.moveDown(0.5)

    const kpis = [
      { label: 'Ingresos Totales', value: fmt(totalRevenue) },
      { label: 'Egresos Totales', value: fmt(totalExpenses) },
      { label: 'Beneficio Neto', value: fmt(profit) },
      { label: 'Clientes Nuevos', value: String(newClients) },
      { label: 'Clientes Totales', value: String(totalClients) },
      { label: 'Oportunidades Nuevas', value: String(newOpportunities) },
      { label: 'Oportunidades Cerradas', value: String(closedOpportunities.length) },
    ]

    kpis.forEach(kpi => {
      doc.fontSize(11).fillColor(gray).text(kpi.label, 50, undefined, { continued: true })
      doc.fillColor(dark).text(`  ${kpi.value}`, { align: 'left' })
    })

    doc.moveDown(1)

    // --- PIPELINE ---
    doc.fontSize(18).fillColor(dark).text('Pipeline de Ventas')
    doc.moveDown(0.3)
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#e2e8f0')
    doc.moveDown(0.5)

    // Table header
    const tableTop = doc.y
    const col1 = 50
    const col2 = 280
    const col3 = 400
    doc.rect(50, tableTop, doc.page.width - 100, 22).fill(lightBg)
    doc.fontSize(10).fillColor(dark)
    doc.text('Etapa', col1 + 8, tableTop + 6)
    doc.text('Oportunidades', col2, tableTop + 6)
    doc.text('Valor Estimado', col3, tableTop + 6)
    doc.y = tableTop + 24

    stages.forEach((stage, i) => {
      const count = stage.opportunities.length
      const value = stage.opportunities.reduce((s, o) => s + o.estimatedValue, 0)
      const rowY = doc.y
      if (i % 2 === 0) {
        doc.rect(50, rowY, doc.page.width - 100, 20).fill('#f8fafc')
      }
      doc.fontSize(10).fillColor(dark).text(stage.name, col1 + 8, rowY + 5)
      doc.text(String(count), col2, rowY + 5)
      doc.text(fmt(value), col3, rowY + 5)
      doc.y = rowY + 20
    })

    // Totals row
    const totalOpps = stages.reduce((s, st) => s + st.opportunities.length, 0)
    const totalValue = stages.reduce((s, st) => s + st.opportunities.reduce((a, o) => a + o.estimatedValue, 0), 0)
    const totalY = doc.y
    doc.rect(50, totalY, doc.page.width - 100, 22).fill(blue)
    doc.fontSize(10).fillColor('#ffffff')
    doc.text('TOTAL', col1 + 8, totalY + 6)
    doc.text(String(totalOpps), col2, totalY + 6)
    doc.text(fmt(totalValue), col3, totalY + 6)
    doc.y = totalY + 30

    doc.moveDown(1)

    // --- TOP CLIENTS ---
    if (doc.y > 550) doc.addPage()
    doc.fontSize(18).fillColor(dark).text('Top 10 Clientes')
    doc.moveDown(0.3)
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#e2e8f0')
    doc.moveDown(0.5)

    const cTableTop = doc.y
    const cCol1 = 50
    const cCol2 = 400
    const cCol3 = 480
    doc.rect(50, cTableTop, doc.page.width - 100, 22).fill(lightBg)
    doc.fontSize(10).fillColor(dark)
    doc.text('#', cCol1 + 8, cTableTop + 6)
    doc.text('Cliente', cCol1 + 30, cTableTop + 6)
    doc.text('Valor Total', cCol3, cTableTop + 6)
    doc.y = cTableTop + 24

    topClients.forEach((client, i) => {
      const rowY = doc.y
      if (i % 2 === 0) doc.rect(50, rowY, doc.page.width - 100, 20).fill('#f8fafc')
      doc.fontSize(10).fillColor(dark)
      doc.text(String(i + 1), cCol1 + 8, rowY + 5)
      doc.text(client.name, cCol1 + 30, rowY + 5)
      doc.text(fmt(client.totalValue), cCol3, rowY + 5)
      doc.y = rowY + 20
    })

    doc.moveDown(1)

    // --- RECENT TRANSACTIONS ---
    if (doc.y > 500) doc.addPage()
    doc.fontSize(18).fillColor(dark).text('Ingresos Recientes')
    doc.moveDown(0.3)
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#e2e8f0')
    doc.moveDown(0.5)

    const recentIncome = incomeTransactions.slice(0, 15)
    const tTableTop = doc.y
    doc.rect(50, tTableTop, doc.page.width - 100, 22).fill(lightBg)
    doc.fontSize(10).fillColor(dark)
    doc.text('Fecha', 58, tTableTop + 6)
    doc.text('Descripcion', 180, tTableTop + 6)
    doc.text('Monto', 460, tTableTop + 6)
    doc.y = tTableTop + 24

    recentIncome.forEach((t, i) => {
      const rowY = doc.y
      if (i % 2 === 0) doc.rect(50, rowY, doc.page.width - 100, 20).fill('#f8fafc')
      doc.fontSize(9).fillColor(dark)
      doc.text(new Date(t.date).toLocaleDateString('es-MX'), 58, rowY + 5)
      doc.text(t.description.slice(0, 40), 180, rowY + 5)
      doc.fillColor('#059669').text(fmt(t.amount), 460, rowY + 5)
      doc.y = rowY + 20
    })

    // Footer
    const pageCount = doc.bufferedPageRange()
    doc.fontSize(8).fillColor(gray)
    doc.text(`CRM ALBRA - Reporte generado automaticamente`, 50, doc.page.height - 30, { align: 'center' })

    doc.end()

    // Wait for the document stream to finish before concatenating
    await pdfFinished

    const pdfBuffer = Buffer.concat(chunks)

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="reporte_${period}_${now.toISOString().split('T')[0]}.pdf"`,
      },
    })
  } catch (error) {
    console.error('PDF generation error:', error)
    return NextResponse.json({ error: 'Error al generar PDF' }, { status: 500 })
  }
}
