import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const perm = await checkPermission(request, 'clients', 'read')
  if (perm instanceof NextResponse) return perm
  const { userId } = perm

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'clients'

  try {
    let csv = ''
    const now = new Date().toISOString().split('T')[0]

    if (type === 'clients') {
      const clients = await db.client.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
      csv = 'Nombre,Telefono,Email,Empresa,Ciudad,Fuente,Temperatura,Score,Notas\n'
      clients.forEach(c => {
        csv += `"${escapeCSV(c.name)}","${escapeCSV(c.phone)}","${escapeCSV(c.email || '')}","${escapeCSV(c.company || '')}","${escapeCSV(c.city || '')}","${c.source}","${c.temperature}",${c.score},"${escapeCSV(c.notes || '')}"\n`
      })
    } else if (type === 'opportunities') {
      const opps = await db.opportunity.findMany({
        where: { userId },
        include: { client: true, stage: true },
        orderBy: { createdAt: 'desc' },
      })
      csv = 'Titulo,Cliente,Etapa,Valor Estimado,Probabilidad,Interes,Notas\n'
      opps.forEach(o => {
        csv += `"${escapeCSV(o.title)}","${escapeCSV(o.client.name)}","${o.stage.name}",${o.estimatedValue},${o.probability},"${escapeCSV(o.interest)}","${escapeCSV(o.notes || '')}"\n`
      })
    } else if (type === 'transactions') {
      const txns = await db.transaction.findMany({ where: { userId }, orderBy: { date: 'desc' } })
      csv = 'Tipo,Monto,Categoria,Descripcion,Fecha\n'
      txns.forEach(t => {
        csv += `"${t.type}",${t.amount},"${escapeCSV(t.category || '')}","${escapeCSV(t.description)}","${new Date(t.date).toISOString().split('T')[0]}"\n`
      })
    } else if (type === 'quotes') {
      const quotes = await db.quote.findMany({
        where: { userId },
        include: { client: true },
        orderBy: { createdAt: 'desc' },
      })
      csv = 'Numero,Cliente,Estado,Subtotal,Descuento,Impuesto,Total,Fecha\n'
      quotes.forEach(q => {
        csv += `"${q.quoteNumber}","${q.client.name}","${q.status}",${q.subtotal},${q.discount},${q.tax},${q.total},"${new Date(q.createdAt).toISOString().split('T')[0]}"\n`
      })
    } else {
      return NextResponse.json({ error: 'Tipo no soportado' }, { status: 400 })
    }

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${type}_export_${now}.csv"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Error al exportar datos' }, { status: 500 })
  }
}

function escapeCSV(value: string): string {
  return value.replace(/"/g, '""')
}
