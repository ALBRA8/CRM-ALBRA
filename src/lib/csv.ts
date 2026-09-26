/**
 * Utilidades CSV sin dependencias: parser tolerante (comillas, comas, saltos
 * de línea dentro de campos, BOM UTF-8) y builder con escape RFC-4180.
 */

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  // último campo/fila
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export interface CsvRecord {
  [header: string]: string
}

/** Convierte filas crudas en objetos usando la primera fila como cabecera */
export function csvToObjects(rows: string[][]): CsvRecord[] {
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((cells) => {
    const obj: CsvRecord = {}
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim()
    })
    return obj
  })
}

function escapeCsv(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Genera CSV con BOM UTF-8 (compatible con Excel en español) */
export function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of rows) lines.push(row.map(escapeCsv).join(','))
  return '\uFEFF' + lines.join('\n')
}
