import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { db } from '@/lib/db'
import ExcelJS from 'exceljs'

export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'reports', 'read')
  if (perm instanceof NextResponse) return perm
  const { userId } = perm

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || '30d'

  const now = new Date()
  let startDate: Date
  switch (period) {
    case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break
    case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break
    case '1y': startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break
    case 'all': startDate = new Date(0); break
    default: startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break
  }

  try {
    const user = await db.user.findUnique({ where: { id: userId } })

    // Fetch all data
    const stages = await db.pipelineStage.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
      include: { opportunities: { include: { client: true } } },
    })

    const incomeTransactions = await db.transaction.findMany({
      where: { userId, type: 'ingreso', date: { gte: startDate } },
      orderBy: { date: 'desc' },
    })
    const expenseTransactions = await db.transaction.findMany({
      where: { userId, type: { in: ['egreso', 'compra_inventario'] }, date: { gte: startDate } },
      orderBy: { date: 'desc' },
    })

    const clients = await db.client.findMany({
      where: { userId },
      include: {
        opportunities: { include: { stage: true } },
        _count: { select: { opportunities: true, reservations: true } },
      },
    })

    const quotes = await db.quote.findMany({
      where: { userId },
      include: { client: true, items: true },
      orderBy: { createdAt: 'desc' },
    })

    const services = await db.service.findMany({ where: { userId } })

    // Create workbook
    const workbook = new ExcelJS.Workbook()
    workbook.creator = user?.name || 'CRM ALBRA'
    workbook.created = now

    const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v)

    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      },
    }

    const dataStyle: Partial<ExcelJS.Style> = {
      font: { size: 10 },
      border: {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      },
    }

    // --- SHEET 1: Resumen ---
    const summarySheet = workbook.addWorksheet('Resumen')
    summarySheet.columns = [
      { header: 'Metrica', key: 'metric', width: 30 },
      { header: 'Valor', key: 'value', width: 25 },
    ]

    const totalRevenue = incomeTransactions.reduce((a, t) => a + t.amount, 0)
    const totalExpenses = expenseTransactions.reduce((a, t) => a + t.amount, 0)

    const summaryData = [
      { metric: 'Empresa', value: user?.company || 'N/A' },
      { metric: 'Periodo del Reporte', value: period },
      { metric: 'Fecha de Generacion', value: now.toLocaleDateString('es-MX') },
      { metric: '', value: '' },
      { metric: 'Ingresos Totales', value: fmt(totalRevenue) },
      { metric: 'Egresos Totales', value: fmt(totalExpenses) },
      { metric: 'Beneficio Neto', value: fmt(totalRevenue - totalExpenses) },
      { metric: '', value: '' },
      { metric: 'Clientes Totales', value: String(clients.length) },
      { metric: 'Clientes Nuevos (periodo)', value: String(clients.filter(c => new Date(c.createdAt) >= startDate).length) },
      { metric: 'Oportunidades Totales', value: String(stages.reduce((s, st) => s + st.opportunities.length, 0)) },
      { metric: 'Cotizaciones Totales', value: String(quotes.length) },
      { metric: 'Productos/Servicios', value: String(services.length) },
    ]

    summaryData.forEach(row => summarySheet.addRow(row))
    summarySheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle))

    // --- SHEET 2: Pipeline ---
    const pipelineSheet = workbook.addWorksheet('Pipeline')
    pipelineSheet.columns = [
      { header: 'Etapa', key: 'stage', width: 20 },
      { header: 'Oportunidades', key: 'count', width: 15 },
      { header: 'Valor Estimado', key: 'value', width: 20 },
    ]
    pipelineSheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle))

    stages.forEach(stage => {
      const count = stage.opportunities.length
      const value = stage.opportunities.reduce((s, o) => s + o.estimatedValue, 0)
      const row = pipelineSheet.addRow({ stage: stage.name, count, value: fmt(value) })
      row.eachCell(cell => Object.assign(cell, dataStyle))
    })

    // --- SHEET 3: Oportunidades ---
    const oppsSheet = workbook.addWorksheet('Oportunidades')
    oppsSheet.columns = [
      { header: 'Titulo', key: 'title', width: 30 },
      { header: 'Cliente', key: 'client', width: 25 },
      { header: 'Etapa', key: 'stage', width: 18 },
      { header: 'Valor Estimado', key: 'value', width: 18 },
      { header: 'Probabilidad', key: 'probability', width: 12 },
      { header: 'Fecha Creacion', key: 'created', width: 15 },
    ]
    oppsSheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle))

    stages.forEach(stage => {
      stage.opportunities.forEach(opp => {
        const row = oppsSheet.addRow({
          title: opp.title,
          client: opp.client?.name || 'N/A',
          stage: stage.name,
          value: fmt(opp.estimatedValue),
          probability: `${opp.probability}%`,
          created: new Date(opp.createdAt).toLocaleDateString('es-MX'),
        })
        row.eachCell(cell => Object.assign(cell, dataStyle))
      })
    })

    // --- SHEET 4: Clientes ---
    const clientsSheet = workbook.addWorksheet('Clientes')
    clientsSheet.columns = [
      { header: 'Nombre', key: 'name', width: 25 },
      { header: 'Telefono', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Empresa', key: 'company', width: 20 },
      { header: 'Ciudad', key: 'city', width: 15 },
      { header: 'Fuente', key: 'source', width: 12 },
      { header: 'Temperatura', key: 'temperature', width: 12 },
      { header: 'Score', key: 'score', width: 8 },
      { header: 'Valor Total', key: 'value', width: 18 },
      { header: 'Oportunidades', key: 'opps', width: 12 },
    ]
    clientsSheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle))

    clients.forEach(client => {
      const totalValue = client.opportunities.reduce((a, o) => a + o.estimatedValue, 0)
      const row = clientsSheet.addRow({
        name: client.name,
        phone: client.phone,
        email: client.email || '',
        company: client.company || '',
        city: client.city || '',
        source: client.source,
        temperature: client.temperature,
        score: client.score,
        value: fmt(totalValue),
        opps: client._count.opportunities,
      })
      row.eachCell(cell => Object.assign(cell, dataStyle))
    })

    // --- SHEET 5: Transacciones ---
    const txnsSheet = workbook.addWorksheet('Transacciones')
    txnsSheet.columns = [
      { header: 'Fecha', key: 'date', width: 15 },
      { header: 'Tipo', key: 'type', width: 15 },
      { header: 'Monto', key: 'amount', width: 18 },
      { header: 'Categoria', key: 'category', width: 20 },
      { header: 'Descripcion', key: 'description', width: 35 },
    ]
    txnsSheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle))

    const allTransactions = [
      ...incomeTransactions.map(t => ({ ...t, typeLabel: 'Ingreso' })),
      ...expenseTransactions.map(t => ({ ...t, typeLabel: t.type === 'compra_inventario' ? 'Compra Inventario' : 'Egreso' })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    allTransactions.forEach(t => {
      const row = txnsSheet.addRow({
        date: new Date(t.date).toLocaleDateString('es-MX'),
        type: t.typeLabel,
        amount: fmt(t.amount),
        category: t.category || '',
        description: t.description,
      })
      row.eachCell(cell => Object.assign(cell, dataStyle))
    })

    // --- SHEET 6: Cotizaciones ---
    const quotesSheet = workbook.addWorksheet('Cotizaciones')
    quotesSheet.columns = [
      { header: 'Numero', key: 'number', width: 12 },
      { header: 'Cliente', key: 'client', width: 25 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'Descuento', key: 'discount', width: 12 },
      { header: 'Impuesto', key: 'tax', width: 12 },
      { header: 'Total', key: 'total', width: 18 },
      { header: 'Fecha', key: 'date', width: 15 },
    ]
    quotesSheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle))

    quotes.forEach(q => {
      const row = quotesSheet.addRow({
        number: q.quoteNumber,
        client: q.client?.name || 'N/A',
        status: q.status,
        subtotal: fmt(q.subtotal),
        discount: fmt(q.discount),
        tax: fmt(q.tax),
        total: fmt(q.total),
        date: new Date(q.createdAt).toLocaleDateString('es-MX'),
      })
      row.eachCell(cell => Object.assign(cell, dataStyle))
    })

    // --- SHEET 7: Productos ---
    const productsSheet = workbook.addWorksheet('Productos')
    productsSheet.columns = [
      { header: 'Nombre', key: 'name', width: 30 },
      { header: 'SKU', key: 'sku', width: 15 },
      { header: 'Precio', key: 'price', width: 15 },
      { header: 'Stock', key: 'stock', width: 10 },
      { header: 'Duracion', key: 'duration', width: 12 },
    ]
    productsSheet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle))

    services.forEach(s => {
      const row = productsSheet.addRow({
        name: s.name,
        sku: s.sku || '',
        price: fmt(s.price),
        stock: String(s.stock),
        duration: s.duration ? `${s.duration} min` : 'N/A',
      })
      row.eachCell(cell => Object.assign(cell, dataStyle))
    })

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="reporte_${period}_${now.toISOString().split('T')[0]}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Excel generation error:', error)
    return NextResponse.json({ error: 'Error al generar Excel' }, { status: 500 })
  }
}
