/**
 * Motor PDF mínimo (sin dependencias) para cotizaciones — Task 24.
 *
 * ¿Por qué a mano? El único uso es descargar una cotización en PDF; añadir
 * pdfkit/puppeteer por eso es desproporcionado (tamaño + vulnerabilidades de
 * sharp/libvips ya presentes). PDF 1.4 con fuentes base-14 (Helvetica) es un
 * formato de texto plano: objetos + xref con offsets exactos al byte.
 *
 * Codificación: WinAnsiEncoding (CP1252). El español (á é í ó ú ñ ü °) vive
 * en U+00FF y coincide byte a byte con latin1; los pocos símbolos fuera de
 * ese rango que usamos (€ – — “”) se mapean a sus bytes CP1252 explícitos.
 * Todo lo desconocido se degrada a '?' — nunca se rompe el archivo.
 */

// ---------- Codificación ----------

const WINANSI_EXTRA: Record<string, number> = {
  '\u20AC': 0x80, // €
  '\u2018': 0x91, // '
  '\u2019': 0x92, // '
  '\u201C': 0x93, // "
  '\u201D': 0x94, // "
  '\u2022': 0x95, // •
  '\u2013': 0x96, // –
  '\u2014': 0x97, // —
  '\u2026': 0x85, // …
}

/** Texto PDF escapado (\, (, )) con mapeo WinAnsi. */
function pdfString(s: string): string {
  let out = ''
  for (const ch of s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')) {
    const extra = WINANSI_EXTRA[ch]
    if (extra !== undefined) {
      out += String.fromCharCode(extra)
    } else {
      const code = ch.codePointAt(0) ?? 0x3f
      out += code <= 0xff ? ch : '?'
    }
  }
  return out
}

function latin1(s: string): Buffer {
  return Buffer.from(s, 'latin1')
}

// ---------- Primitivas de dibujo ----------

const PAGE_W = 595.28
const PAGE_H = 841.89

type RGB = [number, number, number]

const EMERALD: RGB = [0.02, 0.588, 0.412] // #059669
const INK: RGB = [0.204, 0.255, 0.333] // slate-700
const MUTED: RGB = [0.392, 0.455, 0.545] // slate-500
const LINE: RGB = [0.886, 0.91, 0.941] // slate-200
const ZEBRA: RGB = [0.973, 0.98, 0.988] // slate-50
const WHITE: RGB = [1, 1, 1]

function fmtRGB(c: RGB): string {
  return `${c[0]} ${c[1]} ${c[2]}`
}

function text(x: number, y: number, size: number, font: 'F1' | 'F2', s: string, color: RGB): string {
  return `BT ${fmtRGB(color)} rg /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfString(s)}) Tj ET\n`
}

/** Ancho aproximado: suficiente para alinear a la derecha con Helvetica. */
function approxWidth(s: string, size: number): number {
  return size * 0.52 * s.length
}

function textRight(rightX: number, y: number, size: number, font: 'F1' | 'F2', s: string, color: RGB): string {
  return text(rightX - approxWidth(s, size), y, size, font, s, color)
}

function rect(x: number, y: number, w: number, h: number, color: RGB): string {
  return `${fmtRGB(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`
}

function hline(x1: number, x2: number, y: number, color: RGB): string {
  return `${fmtRGB(color)} RG 0.6 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S\n`
}

// ---------- Formato ----------

function fmtMoney(n: number, currency: string): string {
  const symbol = currency === 'USD' || currency === 'COP' || currency === 'MXN' || currency === 'ARS' ? '$ ' : currency === 'EUR' ? '\u20ac ' : `${currency} `
  const fixed = Math.abs(n).toFixed(2)
  const [int, dec] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${symbol}${n < 0 ? '-' : ''}${grouped},${dec}`
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Corte de línea por ancho aproximado (sin medición real de glifos). */
function wrap(s: string, maxChars: number, maxLines: number): string[] {
  const words = (s ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length > maxChars && cur) {
      lines.push(cur)
      cur = w
      if (lines.length === maxLines) break
    } else {
      cur = candidate
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, '') + '…'
  }
  return lines
}

// ---------- Layout de la cotización ----------

const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Expirada',
}

export interface QuotePdfData {
  number: string
  status: string
  currency: string
  createdAt: Date | string
  validUntil: Date | string | null
  subtotal: number
  discount: number
  tax: number
  total: number
  notes: string | null
  orgName?: string | null
  client?: { name?: string | null; email?: string | null; phone?: string | null; address?: string | null } | null
  opportunityTitle?: string | null
  items: Array<{ sku?: string | null; description: string; quantity: number; unitPrice: number; subtotal?: number | null }>
}

interface TableCols {
  descX: number
  qtyRight: number
  unitRight: number
  subRight: number
}

const COLS: TableCols = { descX: 40, qtyRight: 385, unitRight: 470, subRight: 555 }

function drawTableHeader(y: number): string {
  let ops = rect(40, y, 515, 20, EMERALD)
  ops += text(COLS.descX + 8, y + 6, 9.5, 'F2', 'DESCRIPCIÓN', WHITE)
  ops += textRight(COLS.qtyRight, y + 6, 9.5, 'F2', 'CANT.', WHITE)
  ops += textRight(COLS.unitRight, y + 6, 9.5, 'F2', 'V. UNIT.', WHITE)
  ops += textRight(COLS.subRight, y + 6, 9.5, 'F2', 'IMPORTE', WHITE)
  return ops
}

/** Contenido de todas las páginas; devuelve los streams y el índice de la última página con totales. */
function buildPages(d: QuotePdfData): string[] {
  const pages: string[] = []
  let ops = ''

  // ---- Cabecera (solo página 1) ----
  ops += rect(0, PAGE_H - 84, PAGE_W, 84, EMERALD)
  ops += text(40, PAGE_H - 38, 20, 'F2', 'COTIZACIÓN', WHITE)
  ops += text(40, PAGE_H - 58, 10, 'F1', d.orgName || 'CRM ALBRA', WHITE)
  ops += textRight(555, PAGE_H - 38, 13, 'F2', d.number, WHITE)
  ops += textRight(555, PAGE_H - 58, 10, 'F1', QUOTE_STATUS_LABELS[d.status] ?? d.status, WHITE)
  ops += text(40, PAGE_H - 104, 9.5, 'F1', `Fecha de emisión: ${fmtDate(d.createdAt)}`, MUTED)
  ops += text(220, PAGE_H - 104, 9.5, 'F1', `Válida hasta: ${fmtDate(d.validUntil)}`, MUTED)

  // ---- Cliente ----
  let y = PAGE_H - 140
  ops += text(40, y, 8, 'F2', 'CLIENTE', MUTED)
  y -= 17
  ops += text(40, y, 12, 'F2', d.client?.name || 'Consumidor final', INK)
  y -= 14
  const contact = [d.client?.email, d.client?.phone].filter((v): v is string => !!v && v.trim() !== '').join('  ·  ')
  if (contact) {
    ops += text(40, y, 9.5, 'F1', contact, MUTED)
    y -= 13
  }
  if (d.client?.address) {
    ops += text(40, y, 9.5, 'F1', d.client.address, MUTED)
    y -= 13
  }
  if (d.opportunityTitle) {
    y -= 4
    ops += text(40, y, 9.5, 'F1', `Oportunidad: ${d.opportunityTitle}`, MUTED)
    y -= 13
  }

  // ---- Tabla de items (paginada) ----
  y -= 12
  const bottomLimit = 110
  ops += drawTableHeader(y)
  y -= 20

  let firstRowOnPage = true
  const rowOps = (item: QuotePdfData['items'][number], zebra: boolean): string => {
    const lines = wrap(item.description, 62, 2)
    const rowH = 8 + lines.length * 12 + 6
    let o = ''
    if (zebra) o += rect(40, y - rowH + 14, 515, rowH - 6, ZEBRA)
    let ly = y - 4
    for (const line of lines) {
      o += text(COLS.descX + 8, ly, 9.5, 'F1', line, INK)
      ly -= 12
    }
    if (item.sku) o += text(COLS.descX + 8, ly, 8, 'F1', `SKU: ${item.sku}`, MUTED)
    o += textRight(COLS.qtyRight, y - 4, 9.5, 'F1', String(item.quantity), INK)
    o += textRight(COLS.unitRight, y - 4, 9.5, 'F1', fmtMoney(item.unitPrice, d.currency), INK)
    o += textRight(COLS.subRight, y - 4, 9.5, 'F1', fmtMoney(item.subtotal ?? item.quantity * item.unitPrice, d.currency), INK)
    o += hline(40, 555, y - rowH + 10, LINE)
    return o
  }

  for (let i = 0; i < d.items.length; i++) {
    const item = d.items[i]
    const lines = wrap(item.description, 62, 2)
    const rowH = 8 + lines.length * 12 + 6
    if (y - rowH < bottomLimit || (!firstRowOnPage && i > 0 && y - rowH < bottomLimit + 20)) {
      pages.push(ops)
      ops = ''
      y = PAGE_H - 70
      ops += drawTableHeader(y)
      y -= 20
      firstRowOnPage = true
    }
    ops += rowOps(item, !firstRowOnPage && Math.floor(i) % 2 === 1)
    y -= rowH
    firstRowOnPage = false
  }

  // ---- Totales ----
  if (y - 92 < bottomLimit) {
    pages.push(ops)
    ops = ''
    y = PAGE_H - 70
  }
  y -= 14
  const totalRows: Array<[string, string, boolean]> = [
    ['Subtotal', fmtMoney(d.subtotal, d.currency), false],
    ...(d.discount > 0.009 ? ([['Descuento', `- ${fmtMoney(d.discount, d.currency)}`, false]] as Array<[string, string, boolean]>) : []),
    ['IVA (16%)', fmtMoney(d.tax, d.currency), false],
    ['TOTAL', fmtMoney(d.total, d.currency), true],
  ]
  for (const [label, value, bold] of totalRows) {
    if (bold) ops += rect(345, y - 6, 210, 22, ZEBRA)
    ops += textRight(455, y, bold ? 11 : 10, bold ? 'F2' : 'F1', label, bold ? INK : MUTED)
    ops += textRight(547, y, bold ? 11 : 10, bold ? 'F2' : 'F1', value, bold ? INK : MUTED)
    y -= bold ? 28 : 17
  }

  // ---- Notas ----
  if (d.notes && d.notes.trim() !== '') {
    y -= 8
    ops += text(40, y, 8, 'F2', 'NOTAS', MUTED)
    y -= 14
    for (const line of wrap(d.notes, 105, 4)) {
      ops += text(40, y, 9.5, 'F1', line, INK)
      y -= 12
    }
  }

  pages.push(ops)
  return pages
}

// ---------- Ensamblado del archivo PDF ----------

/**
 * Ensambla un PDF 1.4 válido a partir de los content streams de cada página.
 * Estructura: 1=Catalog, 2=Pages, 3=Helvetica, 4=Helvetica-Bold,
 * 5+2k=Página k, 6+2k=Stream k. xref con offsets exactos al byte.
 */
function assemble(contentStreams: string[]): Buffer {
  const n = contentStreams.length
  const kids = Array.from({ length: n }, (_, i) => `${5 + i * 2} 0 R`).join(' ')
  const objects: string[] = []
  // 1..4 fijos
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  for (let i = 0; i < n; i++) {
    const pageObj = 5 + i * 2
    const streamObj = pageObj + 1
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObj} 0 R >>`
  }
  for (let i = 0; i < n; i++) {
    const streamObj = 6 + i * 2
    const content = contentStreams[i]
    objects[streamObj] = `<< /Length ${latin1(content).length} >>\nstream\n${content}endstream`
  }

  const chunks: Buffer[] = []
  let offset = 0
  const offsets: number[] = []
  const push = (s: string) => {
    const b = latin1(s)
    chunks.push(b)
    offset += b.length
  }

  push('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n') // binario de referencia (4 bytes > 127)
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = offset
    push(`${i} 0 obj\n${objects[i]}\nendobj\n`)
  }
  const xrefStart = offset
  const size = objects.length // último índice + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (let i = 1; i < size; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

  return Buffer.concat(chunks)
}

/** Punto de entrada: cotización serializada → PDF válido como bytes. */
export function buildQuotePdf(data: QuotePdfData): ArrayBuffer {
  const buf = assemble(buildPages(data))
  const out = new ArrayBuffer(buf.length)
  new Uint8Array(out).set(buf)
  return out
}
