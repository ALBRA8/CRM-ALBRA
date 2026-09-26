import { describe, expect, it } from 'vitest'
import { GET as exportCsvGET } from '@/app/api/export/csv/route'
import { FIX, req, tokenA, tokenB } from '../helpers'

/**
 * Export CSV (/api/export/csv, handler real) — caso 'transactions' restaurado
 * en la auditoría (importante #1): 200 con cabeceras correctas y BOM UTF-8,
 * aislado por organización y SIN escribir archivos en disco (solo respuesta).
 */

describe('GET /api/export/csv?type=transactions', () => {
  it('401 sin token', async () => {
    const res = await exportCsvGET(req('/api/export/csv?type=transactions'))
    expect(res.status).toBe(401)
  })

  it('200 con Content-Type text/csv, BOM UTF-8 y cabecera completa', async () => {
    const res = await exportCsvGET(req('/api/export/csv?type=transactions', { token: tokenA() }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="export_transactions_/)

    // BOM UTF-8 en los BYTES crudos (res.text() lo elimina según el estándar Fetch).
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])

    // TextDecoder('utf-8') también consume el BOM al decodificar.
    const csv = new TextDecoder('utf-8').decode(bytes)
    const header = csv.split('\n')[0]
    expect(header).toBe('date,type,amount,currency,category,description,method,client,createdAt')
  })

  it('incluye las transacciones de la org con su cliente asociado', async () => {
    const res = await exportCsvGET(req('/api/export/csv?type=transactions', { token: tokenA() }))
    const csv = await res.text()
    const rows = csv
      .split('\n')
      .filter((r) => r.trim() !== '')

    // Semilla org A: 4 transacciones (3 'ingreso'/'egreso' + 1 'income' en inglés)
    expect(rows.length).toBe(5) // cabecera + 4 filas
    const dataRows = rows.slice(1)
    expect(dataRows.some((r) => r.includes('ingreso') && r.includes('1000') && r.includes(FIX.clientA1.name))).toBe(true)
    expect(dataRows.some((r) => r.includes('egreso') && r.includes('60'))).toBe(true)
  })

  it('aislamiento multi-tenant: el CSV de org B no contiene datos de org A', async () => {
    const res = await exportCsvGET(req('/api/export/csv?type=transactions', { token: tokenB() }))
    const csv = await res.text()
    expect(csv).toContain(FIX.txOrgB.description)
    expect(csv).not.toContain(FIX.clientA1.name)
    expect(csv).not.toContain('Suscripción tooling')
  })

  it('400 para un type no soportado', async () => {
    const res = await exportCsvGET(req('/api/export/csv?type=secretos', { token: tokenA() }))
    expect(res.status).toBe(400)
  })
})
