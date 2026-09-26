import { describe, expect, it } from 'vitest'
import { GET as reportsPdfGET } from '@/app/api/reports/pdf/route'
import { FIX, digitsOf, jsonBody, pdfLines, req, tokenA, tokenB } from '../helpers'

/**
 * Reportes PDF (/api/reports/pdf, handler real):
 * - el filtro debe sumar 'ingreso'/'egreso' (idioma real de la BD) y NO dar $0
 *   (regresión del crítico #5 de la auditoría Antigravity);
 * - la moneda dominante viene de las transacciones del período;
 * - aislamiento multi-tenant en los totales.
 *
 * Semilla org A: ingresos 1000 + 400 = 1400, egreso 60 → balance 1340.
 * Semilla org B: ingreso 500.
 * La tx type 'income' (9999, inglés) documenta el vocabulario soportado.
 */

function findLine(lines: string[], prefix: string): string | undefined {
  return lines.find((l) => l.startsWith(prefix))
}

describe('reportes PDF — /api/reports/pdf', () => {
  it('rechaza sin token con 401', async () => {
    const res = await reportsPdfGET(req('/api/reports/pdf?period=all'))
    expect(res.status).toBe(401)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/token/i)
  })

  it('200 con Content-Type application/pdf y encabezado %PDF', async () => {
    const res = await reportsPdfGET(req('/api/reports/pdf?period=all', { token: tokenA() }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('.pdf')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(500)
  })

  it('suma ingresos/egresos del idioma real de la BD (no $0) y calcula el balance', async () => {
    const res = await reportsPdfGET(req('/api/reports/pdf?period=all', { token: tokenA() }))
    const lines = pdfLines(Buffer.from(await res.arrayBuffer()))

    const ingresos = findLine(lines, 'Ingresos:')
    const egresos = findLine(lines, 'Egresos:')
    const balance = findLine(lines, 'Balance:')
    expect(ingresos).toBeDefined()
    expect(egresos).toBeDefined()
    expect(balance).toBeDefined()

    expect(digitsOf(ingresos!)).toBe('1400') // 1000 + 400
    expect(digitsOf(egresos!)).toBe('60')
    expect(digitsOf(balance!)).toBe('1340')
  })

  it('excluye transacciones con tipo en inglés (documenta el vocabulario actual)', async () => {
    const res = await reportsPdfGET(req('/api/reports/pdf?period=all', { token: tokenA() }))
    const lines = pdfLines(Buffer.from(await res.arrayBuffer()))
    // La tx type 'income' por 9999 no se cuenta: la BD real guarda 'ingreso'.
    expect(digitsOf(findLine(lines, 'Ingresos:')!)).not.toBe('11399')
  })

  it('aislamiento multi-tenant: org B solo ve sus propias cifras', async () => {
    const res = await reportsPdfGET(req('/api/reports/pdf?period=all', { token: tokenB() }))
    const lines = pdfLines(Buffer.from(await res.arrayBuffer()))
    expect(digitsOf(findLine(lines, 'Ingresos:')!)).toBe('500')
    expect(digitsOf(findLine(lines, 'Balance:')!)).toBe('500')
  })
})
