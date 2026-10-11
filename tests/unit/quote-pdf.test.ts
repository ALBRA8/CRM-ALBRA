import { describe, it, expect } from 'vitest'
import { buildQuotePdf, type QuotePdfData } from '@/app/api/_lib/pdf'

const base: QuotePdfData = {
  number: 'COT-0001',
  status: 'sent',
  currency: 'USD',
  createdAt: new Date('2026-09-30T12:00:00Z'),
  validUntil: new Date('2026-10-15T12:00:00Z'),
  subtotal: 1000,
  discount: 50,
  tax: 152,
  total: 1102,
  notes: 'Notas con (paréntesis), \\backslash y acentos: áéíóú ñ',
  orgName: 'Prueba S.A.S',
  client: { name: 'María González', email: 'maria@x.co', phone: '+57 300 111 2233', address: 'Calle 1 #2-3' },
  opportunityTitle: 'Venta demo',
  items: [
    { sku: 'SRV-1', description: 'Asesoría (contable) especial', quantity: 2, unitPrice: 400, subtotal: 800 },
    { description: 'Licencia anual', quantity: 1, unitPrice: 200, subtotal: 200 },
  ],
}

/** Decodifica la tabla xref y devuelve el offset de cada objeto (1-indexed). */
function xrefOffsets(bytes: ArrayBuffer): number[] {
  const raw = Buffer.from(bytes).toString('latin1')
  const m = raw.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/)
  if (!m) throw new Error('sin xref')
  const count = parseInt(m[1], 10)
  const rows = m[2].split('\n').filter((r) => /^\d{10} \d{5} [nf]/.test(r))
  expect(rows).toHaveLength(count)
  return rows.map((r) => parseInt(r.slice(0, 10), 10))
}

describe('buildQuotePdf', () => {
  it('produce un archivo que empieza con %PDF-1.4 y termina con %%EOF', () => {
    const pdf = Buffer.from(buildQuotePdf(base)).toString('latin1')
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('xref apunta exactamente a cada "N 0 obj" (offsets válidos)', () => {
    const bytes = buildQuotePdf(base)
    const raw = Buffer.from(bytes).toString('latin1')
    const offsets = xrefOffsets(bytes)
    offsets.forEach((off, idx) => {
      if (idx === 0) {
        expect(off).toBe(0) // objeto 0 libre
        return
      }
      expect(raw.slice(off, off + 20)).toMatch(new RegExp(`^${idx} 0 obj`))
    })
  })

  it('startxref apunta a la tabla xref', () => {
    const bytes = buildQuotePdf(base)
    const raw = Buffer.from(bytes).toString('latin1')
    const m = raw.match(/startxref\n(\d+)\n%%EOF/)
    expect(m).toBeTruthy()
    expect(raw.slice(parseInt(m![1], 10)).startsWith('xref')).toBe(true)
  })

  it('escapa ( ) \\ dentro de los textos PDF', () => {
    const pdf = Buffer.from(buildQuotePdf(base)).toString('latin1')
    expect(pdf).toContain('Asesoría \\(contable\\) especial')
    expect(pdf).toContain('\\backslash'.replace('\\', '\\\\'))
  })

  it('codifica acentos en WinAnsi (latin1) sin corromper bytes', () => {
    const bytes = buildQuotePdf(base)
    const raw = Buffer.from(bytes).toString('latin1')
    expect(raw).toContain('María González')
    expect(raw).toContain('COTIZACIÓN')
  })

  it('pagina cuando hay muchos items (/Count > 1) y todos tienen /Page', () => {
    const many: QuotePdfData = {
      ...base,
      items: Array.from({ length: 60 }, (_, i) => ({
        description: `Item número ${i + 1} con una descripción suficientemente larga para ocupar su línea`,
        quantity: 1,
        unitPrice: 10,
        subtotal: 10,
      })),
    }
    const pdf = Buffer.from(buildQuotePdf(many)).toString('latin1')
    const count = parseInt(pdf.match(/\/Count (\d+)/)![1], 10)
    expect(count).toBeGreaterThan(1)
    expect(pdf.match(/\/Type \/Page[^s]/g)!.length).toBe(count)
  })

  it('número y estado del quote aparecen en el documento', () => {
    const pdf = Buffer.from(buildQuotePdf(base)).toString('latin1')
    expect(pdf).toContain('COT-0001')
    expect(pdf).toContain('Enviada')
    expect(pdf).toContain('TOTAL')
  })
})
