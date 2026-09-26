/**
 * Generador mínimo de PDF sin dependencias (una página por bloque de texto,
 * fuente estándar Helvetica — no requiere archivos .afm externos, por lo que
 * funciona en bundlers donde pdfkit falla).
 * Soporta texto Latin-1 (español: acentos y ñ).
 */

interface PdfLine {
  text: string
  size?: number
  bold?: boolean
}

function escapePdfText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // latin-1: mapear caracteres fuera de rango
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

export function buildSimplePdf(title: string, lines: PdfLine[]): Buffer {
  const pageHeight = 792 // letter
  const pageWidth = 612
  const margin = 54
  const lineHeight = 16

  // Paginación simple
  const pages: PdfLine[][] = []
  let current: PdfLine[] = []
  let y = pageHeight - margin
  const pushPage = () => {
    if (current.length) pages.push(current)
    current = []
    y = pageHeight - margin
  }
  for (const line of [{ text: title, size: 18, bold: true }, ...lines]) {
    const size = line.size ?? 10
    const lh = Math.max(lineHeight, size + 4)
    if (y - lh < margin) pushPage()
    current.push(line)
    y -= lh
  }
  pushPage()
  if (pages.length === 0) pages.push([{ text: '(sin datos)', size: 10 }])

  // Objetos PDF
  const objects: string[] = []
  const pageObjIds: number[] = []
  const contentObjIds: number[] = []

  // 1: Catalog, 2: Pages, fonts 3 (regular) y 4 (bold), luego page/content pares
  const catalogId = 1
  const pagesId = 2
  const fontRegularId = 3
  const fontBoldId = 4

  let nextId = 5
  for (let i = 0; i < pages.length; i++) {
    const pageId = nextId++
    const contentId = nextId++
    pageObjIds.push(pageId)
    contentObjIds.push(contentId)
  }

  const contentStreams = pages.map((pageLines) => {
    let yy = pageHeight - margin
    const out: string[] = ['BT']
    for (const line of pageLines) {
      const size = line.size ?? 10
      const font = line.bold ? '/F2' : '/F1'
      out.push(`${font} ${size} Tf`)
      out.push(`1 0 0 1 ${margin} ${yy} Tm`)
      out.push(`(${escapePdfText(line.text)}) Tj`)
      yy -= Math.max(lineHeight, size + 4)
    }
    out.push('ET')
    return out.join('\n')
  })

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[fontRegularId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`
  objects[fontBoldId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`

  pageObjIds.forEach((pageId, idx) => {
    objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjIds[idx]} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`
    objects[contentObjIds[idx]] = `<< /Length ${Buffer.byteLength(contentStreams[idx], 'latin1')} >>\nstream\n${contentStreams[idx]}\nendstream`
  })

  // Serializar
  const chunks: string[] = []
  const offsets: number[] = []
  let pos = 0
  const header = '%PDF-1.4\n'
  chunks.push(header)
  pos += header.length

  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue
    offsets[id] = pos
    const body = `${id} 0 obj\n${objects[id]}\nendobj\n`
    chunks.push(body)
    pos += body.length
  }

  const xrefStart = pos
  const maxId = objects.length
  let xref = `xref\n0 ${maxId}\n0000000000 65535 f \n`
  for (let id = 1; id < maxId; id++) {
    const off = offsets[id] ?? 0
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`
  }
  chunks.push(xref)
  chunks.push(`trailer\n<< /Size ${maxId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

  return Buffer.from(chunks.join(''), 'latin1')
}
