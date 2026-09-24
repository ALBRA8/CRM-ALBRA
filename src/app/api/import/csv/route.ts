import { NextRequest, NextResponse } from 'next/server'
import { checkPermission } from '@/lib/permissions'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  const perm = await checkPermission(request, 'clients', 'create')
  if (perm instanceof NextResponse) return perm
  const { userId } = perm

  try {
    const formData = await request.formData()
    const type = formData.get('type') as string
    const file = formData.get('file') as File

    if (!type || !file) {
      return NextResponse.json({ error: 'Tipo y archivo son requeridos' }, { status: 400 })
    }

    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) {
      return NextResponse.json({ error: 'El CSV debe tener al menos una fila de encabezados y una de datos' }, { status: 400 })
    }

    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase())
    let created = 0
    let skipped = 0
    let errors = 0

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i])
        const row: Record<string, string> = {}
        headers.forEach((h, idx) => { row[h] = (values[idx] ?? '').trim() })

        if (type === 'clients') {
          const name = row['nombre'] || row['name']
          const phone = row['telefono'] || row['phone']
          if (!name || !phone) { skipped++; continue }
          await db.client.create({
            data: {
              userId,
              name,
              phone,
              email: row['email'] || row['correo'] || null,
              company: row['empresa'] || row['company'] || null,
              city: row['ciudad'] || row['city'] || null,
              source: row['fuente'] || row['source'] || 'manual',
              temperature: row['temperatura'] || row['temperature'] || 'Frio',
              notes: row['notas'] || row['notes'] || null,
            }
          })
          created++
        } else if (type === 'opportunities') {
          const title = row['titulo'] || row['title']
          const clientPhone = row['telefono'] || row['phone']
          if (!title) { skipped++; continue }
          let clientId = row['clientid'] || row['cliente_id']
          if (!clientId && clientPhone) {
            const client = await db.client.findFirst({ where: { userId, phone: clientPhone } })
            if (client) clientId = client.id
          }
          if (!clientId) { skipped++; continue }
          const stages = await db.pipelineStage.findMany({ where: { userId }, orderBy: { order: 'asc' } })
          const stageId = stages[0]?.id
          if (!stageId) { skipped++; continue }
          await db.opportunity.create({
            data: {
              userId,
              clientId,
              stageId,
              title,
              interest: row['interes'] || row['interest'] || '',
              estimatedValue: parseFloat(row['valor'] || row['value'] || '0') || 0,
              notes: row['notas'] || row['notes'] || null,
            }
          })
          created++
        } else if (type === 'transactions') {
          const description = row['descripcion'] || row['description']
          const amount = parseFloat(row['monto'] || row['amount'] || '0')
          const tType = row['tipo'] || row['type'] || 'ingreso'
          if (!description || !amount) { skipped++; continue }
          await db.transaction.create({
            data: {
              userId,
              type: tType,
              amount,
              category: row['categoria'] || row['category'] || null,
              description,
              date: row['fecha'] || row['date'] ? new Date(row['fecha'] || row['date']) : new Date(),
            }
          })
          created++
        } else {
          skipped++
        }
      } catch {
        errors++
      }
    }

    return NextResponse.json({ created, skipped, errors })
  } catch {
    return NextResponse.json({ error: 'Error al procesar el archivo CSV' }, { status: 500 })
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}
