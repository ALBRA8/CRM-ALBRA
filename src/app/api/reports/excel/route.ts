import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'

/**
 * GET /api/reports/excel?period=7d|30d|90d|1y|all — Excel .xlsx del reporte
 * (token por query o Bearer). Usa exceljs; si la librería no está disponible
 * degrada con un 400 descriptivo (sin 500).
 */

type ExcelJSModule = typeof import('exceljs')
type ExcelRow = import('exceljs').Row

async function buildWorkbookBuffer(orgId: string, period: string, days: number | null): Promise<Buffer | null> {
  let ExcelJS: ExcelJSModule | null = null
  try {
    const mod = (await import('exceljs')) as ExcelJSModule & { default?: ExcelJSModule }
    ExcelJS = mod.default && 'Workbook' in mod.default ? mod.default : mod
  } catch {
    return null
  }
  const from = days ? new Date(Date.now() - days * 86_400_000) : new Date(0)

  const [transactions, opportunities, clients] = await Promise.all([
    db.transaction.findMany({ where: { organizationId: orgId, date: { gte: from } }, orderBy: { date: 'desc' }, select: { type: true, amount: true, category: true, description: true, date: true } }),
    db.opportunity.findMany({ where: { organizationId: orgId, createdAt: { gte: from } }, orderBy: { createdAt: 'desc' }, select: { title: true, amount: true, status: true, source: true, createdAt: true } }),
    db.client.findMany({ where: { organizationId: orgId, createdAt: { gte: from } }, orderBy: { createdAt: 'desc' }, select: { name: true, phone: true, email: true, status: true, source: true, createdAt: true } }),
  ])

  const wb = new ExcelJS.Workbook()
  wb.creator = 'CRM ALBRA'
  wb.created = new Date()

  const styleHeader = (row: ExcelRow) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } }
  }

  // Hoja resumen
  const summary = wb.addWorksheet('Resumen')
  summary.columns = [
    { header: 'Métrica', key: 'k', width: 34 },
    { header: 'Valor', key: 'v', width: 26 },
  ]
  styleHeader(summary.getRow(1))
  // BUG DE IDIOMA (auditoría Antigravity, crítico #5): la BD guarda 'ingreso'/'egreso'.
  const income = transactions.filter((t) => t.type === 'ingreso').reduce((a, t) => a + t.amount, 0)
  const expenses = transactions.filter((t) => t.type === 'egreso').reduce((a, t) => a + t.amount, 0)
  const won = opportunities.filter((o) => o.status === 'won')
  const rows = [
    { k: 'Período', v: period },
    { k: 'Generado', v: new Date().toLocaleString('es-CO') },
    { k: 'Ingresos', v: income },
    { k: 'Egresos', v: expenses },
    { k: 'Balance', v: income - expenses },
    { k: 'Clientes nuevos', v: clients.length },
    { k: 'Oportunidades nuevas', v: opportunities.length },
    { k: 'Oportunidades ganadas', v: won.length },
    { k: 'Valor ganado', v: won.reduce((a, o) => a + o.amount, 0) },
  ]
  summary.addRows(rows)
  for (let i = 4; i <= 6; i++) summary.getCell(`B${i}`).numFmt = '#,##0.00'

  // Hoja transacciones
  const txSheet = wb.addWorksheet('Transacciones')
  txSheet.columns = [
    { header: 'Fecha', key: 'date', width: 14 },
    { header: 'Tipo', key: 'type', width: 10 },
    { header: 'Categoría', key: 'category', width: 18 },
    { header: 'Descripción', key: 'description', width: 40 },
    { header: 'Monto', key: 'amount', width: 14 },
  ]
  styleHeader(txSheet.getRow(1))
  for (const t of transactions) {
    txSheet.addRow({ date: t.date.toISOString().split('T')[0], type: t.type, category: t.category || '', description: t.description || '', amount: t.amount })
  }

  // Hoja oportunidades
  const oppSheet = wb.addWorksheet('Oportunidades')
  oppSheet.columns = [
    { header: 'Título', key: 'title', width: 38 },
    { header: 'Monto', key: 'amount', width: 14 },
    { header: 'Estado', key: 'status', width: 12 },
    { header: 'Fuente', key: 'source', width: 14 },
    { header: 'Creada', key: 'createdAt', width: 14 },
  ]
  styleHeader(oppSheet.getRow(1))
  for (const o of opportunities) {
    oppSheet.addRow({ title: o.title, amount: o.amount, status: o.status, source: o.source || '', createdAt: o.createdAt.toISOString().split('T')[0] })
  }

  // Hoja clientes
  const clientSheet = wb.addWorksheet('Clientes')
  clientSheet.columns = [
    { header: 'Nombre', key: 'name', width: 30 },
    { header: 'Teléfono', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Estado', key: 'status', width: 12 },
    { header: 'Fuente', key: 'source', width: 14 },
    { header: 'Creado', key: 'createdAt', width: 14 },
  ]
  styleHeader(clientSheet.getRow(1))
  for (const c of clients) {
    clientSheet.addRow({ name: c.name, phone: c.phone || '', email: c.email || '', status: c.status, source: c.source || '', createdAt: c.createdAt.toISOString().split('T')[0] })
  }

  const arrayBuffer = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = getAuth(req)
    if (!auth) return json({ error: 'Token de autorización requerido' }, { status: 401 })
    const period = new URL(req.url).searchParams.get('period') || '30d'
    const days: number | null = { '7d': 7, '30d': 30, month: 30, '90d': 90, quarter: 90, '1y': 365, year: 365, all: null }[period] ?? 30

    const buffer = await buildWorkbookBuffer(auth.orgId, period, days)
    if (!buffer) {
      return json({ error: 'Generador de Excel no disponible (exceljs no instalado). Usa la exportación CSV.' }, { status: 400 })
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="reporte_${period}_${new Date().toISOString().split('T')[0]}.xlsx"`,
      },
    })
  })
}
