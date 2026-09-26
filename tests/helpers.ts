import { NextRequest } from 'next/server'
import { signToken } from '@/lib/auth'
import { FIX } from './setup/seed-data'

/**
 * Utilidades compartidas por los tests:
 * - Tokens JWT firmados con el APP_SECRET real (cargado por dotenv en el setup).
 * - Construcción de NextRequest para invocar los handlers de las rutas API
 *   como funciones puras (sin levantar el servidor de Next).
 * - Extracción de texto de los PDF generados por src/lib/pdf.ts (contenido
 *   sin comprimir: los renglones quedan como "(texto) Tj").
 */

const BASE_URL = 'http://localhost:3000'

export type SeedUser = (typeof FIX)['userA'] | (typeof FIX)['userB']

export function tokenFor(user: SeedUser): string {
  return signToken({
    userId: user.id,
    orgId: user.organizationId,
    role: user.role,
    email: user.email,
  })
}

export const tokenA = (): string => tokenFor(FIX.userA) // owner de org-a
export const tokenB = (): string => tokenFor(FIX.userB) // member de org-b

export interface RequestOpts {
  method?: string
  token?: string
  /** Cookie cruda para probar el modo de auth httpOnly (sin header Bearer). */
  cookie?: string
  body?: unknown
}

/** Construye un NextRequest listo para pasárselo a un handler de ruta. */
export function req(pathWithQuery: string, opts: RequestOpts = {}): NextRequest {
  const headers = new Headers()
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (opts.cookie) headers.set('cookie', opts.cookie)
  if (opts.body !== undefined) headers.set('content-type', 'application/json')
  return new NextRequest(BASE_URL + pathWithQuery, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

/** Next 15+/16: los handlers reciben params como Promise. */
export function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

export async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

/** Extrae los renglones de texto de un PDF generado con buildSimplePdf. */
export function pdfLines(buf: Buffer): string[] {
  const text = buf.toString('latin1')
  const lines: string[] = []
  const re = /\(((?:\\.|[^\\)])*)\) Tj/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    lines.push(match[1].replace(/\\([()\\])/g, '$1'))
  }
  return lines
}

/** Deja solo los dígitos de una cifra formateada ("US$ 1.400" → "1400"). */
export function digitsOf(formatted: string): string {
  return formatted.replace(/[^\d]/g, '')
}

export { FIX }
