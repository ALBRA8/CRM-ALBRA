import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { parseCsv, csvToObjects } from '@/lib/csv'
import { auditAndTimeline } from '@/lib/api-helpers'
import { normalizePhone } from '@/lib/integrations'

/**
 * POST /api/import/csv — multipart/form-data: file + type=clients|services (requireAuth).
 * Cabeceras esperadas: name,phone,email,status,... (clientes) / name,description,category,price,...
 * Respuesta: { imported, created, skipped, errors, errorList } (clients-list.tsx lee created/skipped/errors).
 */

interface ImportResult {
  imported: number
  created: number
  skipped: number
  errors: number
  errorList: Array<{ row: number; error: string }>
}

function toNumber(v: string | undefined): number {
  if (!v) return 0
  const n = Number(v.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return json({ error: 'Se esperaba multipart/form-data con los campos file y type' }, { status: 400 })
    }
    const file = form.get('file')
    const type = String(form.get('type') || 'clients')
    if (!(file instanceof File)) return json({ error: 'Archivo CSV requerido (campo "file")' }, { status: 400 })
    if (!['clients', 'services'].includes(type)) {
      return json({ error: 'type debe ser "clients" o "services"' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) return json({ error: 'El archivo supera 5MB' }, { status: 400 })

    const text = await file.text()
    const rows = csvToObjects(parseCsv(text))
    const result: ImportResult = { imported: 0, created: 0, skipped: 0, errors: 0, errorList: [] }

    const pick = (row: Record<string, string>, ...keys: string[]): string => {
      for (const key of keys) {
        const found = Object.keys(row).find((k) => k.toLowerCase().trim() === key)
        if (found && row[found]) return row[found].trim()
      }
      return ''
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNumber = i + 2 // +1 cabecera, +1 humano
      try {
        if (type === 'clients') {
          const name = pick(row, 'name', 'nombre')
          if (!name) {
            result.skipped++
            result.errorList.push({ row: rowNumber, error: 'Falta name' })
            continue
          }
          const phone = normalizePhone(pick(row, 'phone', 'telefono', 'teléfono', 'celular', 'whatsapp'))
          const email = pick(row, 'email', 'correo') || null
          if (phone) {
            const dup = await db.client.findFirst({ where: { organizationId: auth.orgId, phone }, select: { id: true } })
            if (dup) {
              result.skipped++
              result.errorList.push({ row: rowNumber, error: `Duplicado: ${name} (${phone})` })
              continue
            }
          }
          const statusRaw = pick(row, 'status', 'estado').toLowerCase()
          const status = ['prospect', 'active', 'inactive'].includes(statusRaw) ? statusRaw : 'prospect'
          const client = await db.client.create({
            data: {
              organizationId: auth.orgId,
              name: name.slice(0, 120),
              phone: phone || null,
              email: email ? email.slice(0, 160) : null,
              status,
              source: pick(row, 'source', 'origen') || 'manual',
              cedula: pick(row, 'cedula', 'cédula', 'documento') || null,
              address: pick(row, 'address', 'direccion', 'dirección') || null,
              notes: pick(row, 'notes', 'notas') || null,
              createdById: auth.userId,
            },
          })
          try {
            const { runWorkflowsForTrigger } = await import('@/lib/workflow-engine')
            await runWorkflowsForTrigger({ orgId: auth.orgId, type: 'client_created', payload: { ...client, source: 'import' } as unknown as Record<string, unknown> })
          } catch {
            /* workflow no debe romper la importación */
          }
          result.created++
        } else {
          const name = pick(row, 'name', 'nombre', 'servicio')
          if (!name) {
            result.skipped++
            result.errorList.push({ row: rowNumber, error: 'Falta name' })
            continue
          }
          await db.service.create({
            data: {
              organizationId: auth.orgId,
              name: name.slice(0, 160),
              description: pick(row, 'description', 'descripcion', 'descripción') || null,
              category: pick(row, 'category', 'categoría', 'categoria') || null,
              price: toNumber(pick(row, 'price', 'precio', 'valor')),
              duration: parseInt(pick(row, 'duration', 'duracion', 'duración'), 10) || null,
              unit: pick(row, 'unit', 'unidad') || 'unidad',
            },
          })
          result.created++
        }
      } catch (err) {
        result.errors++
        result.errorList.push({ row: rowNumber, error: err instanceof Error ? err.message : 'Error desconocido' })
      }
    }
    result.imported = result.created

    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'imported',
      entity: type,
      details: { file: file.name, created: result.created, skipped: result.skipped, errors: result.errors },
    })

    return json(result)
  })
}
