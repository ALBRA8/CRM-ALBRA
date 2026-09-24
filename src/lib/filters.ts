'use client'

/**
 * Helpers de filtrado en cliente + cliente HTTP para Vistas Guardadas.
 * Replica las convenciones de src/lib/api.ts (Authorization Bearer con el
 * token de localStorage 'crm_token', errores como { error }).
 * Task 2-c — Feature B (Vistas guardadas estilo Twenty CRM).
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type FilterOperator = 'equals' | 'contains' | 'gt' | 'lt' | 'in' | 'not_empty'

export interface SavedViewFilter {
  field: string
  operator: FilterOperator
  value?: string
}

export interface SavedView {
  id: string
  name: string
  entity: string
  filters: string | null
  sort?: string | null
  isShared: boolean
  isDefault: boolean
}

// ─── Etiquetas amables (español) ─────────────────────────────────────────────

export const operatorLabels: Record<FilterOperator, string> = {
  equals: 'es igual a',
  contains: 'contiene',
  gt: 'mayor que',
  lt: 'menor que',
  in: 'está en',
  not_empty: 'no está vacío',
}

export const clientFieldLabels: Record<string, string> = {
  name: 'Nombre',
  email: 'Email',
  phone: 'Teléfono',
  company: 'Empresa',
  city: 'Ciudad',
  source: 'Fuente',
  temperature: 'Temperatura',
  score: 'Score',
  lastContactAt: 'Último contacto',
}

export const opportunityFieldLabels: Record<string, string> = {
  title: 'Título',
  interest: 'Interés',
  estimatedValue: 'Monto',
  probability: 'Probabilidad',
  nextAction: 'Próxima acción',
  'client.name': 'Cliente',
}

/** Descripción legible de un filtro para los badges activos. */
export function describeFilter(f: SavedViewFilter, entity: 'clients' | 'opportunities'): string {
  const labels = entity === 'clients' ? clientFieldLabels : opportunityFieldLabels
  const field = labels[f.field] ?? f.field
  if (f.operator === 'not_empty') return `${field} ${operatorLabels.not_empty}`
  return `${field} ${operatorLabels[f.operator] ?? f.operator} ${f.value ?? ''}`.trim()
}

// ─── Motor de filtrado en cliente ────────────────────────────────────────────

/** Obtiene un valor por ruta con puntos ('client.name'). */
function getPath(item: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return acc
    return (acc as Record<string, unknown>)[key]
  }, item)
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function matchesFilter(item: unknown, f: SavedViewFilter): boolean {
  const raw = getPath(item, f.field)

  switch (f.operator) {
    case 'equals':
      return String(raw ?? '').toLowerCase() === String(f.value ?? '').toLowerCase()
    case 'contains':
      return String(raw ?? '')
        .toLowerCase()
        .includes(String(f.value ?? '').toLowerCase())
    case 'gt':
    case 'lt': {
      const a = toNumber(raw)
      const b = toNumber(f.value)
      if (a !== null && b !== null) return f.operator === 'gt' ? a > b : a < b
      // Comparación lexicográfica (fechas ISO, textos)
      const sa = String(raw ?? '')
      const sb = String(f.value ?? '')
      if (!sa) return false
      return f.operator === 'gt' ? sa > sb : sa < sb
    }
    case 'in': {
      const list = String(f.value ?? '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
      return list.includes(String(raw ?? '').toLowerCase())
    }
    case 'not_empty':
      return raw !== null && raw !== undefined && String(raw).trim() !== ''
    default:
      return true
  }
}

/** Aplica una lista de filtros (AND) sobre un arreglo en memoria. */
export function applyFilters<T>(items: T[], filters: SavedViewFilter[]): T[] {
  if (!filters || filters.length === 0) return items
  return items.filter((item) => filters.every((f) => matchesFilter(item, f)))
}

/** Parsea el JSON de filtros guardados en una vista (tolerante a errores). */
export function parseViewFilters(json: string | null | undefined): SavedViewFilter[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    const validOps: FilterOperator[] = ['equals', 'contains', 'gt', 'lt', 'in', 'not_empty']
    return parsed
      .filter((f: unknown): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({
        field: String(f.field ?? ''),
        operator: (validOps.includes(f.operator as FilterOperator) ? f.operator : 'equals') as FilterOperator,
        value: f.value == null ? '' : String(f.value),
      }))
      .filter((f) => f.field !== '')
  } catch {
    return []
  }
}

// ─── API de Vistas Guardadas (mismo patrón que src/lib/api.ts) ───────────────

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('crm_token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...options, headers: getAuthHeaders() })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Error de conexión' }))
    throw new Error(error.error || `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchSavedViews(entity: 'clients' | 'opportunities' | 'quotes'): Promise<SavedView[]> {
  const data = await request<{ views: SavedView[] }>(`/saved-views?entity=${entity}`)
  return data.views ?? []
}

export async function createSavedView(data: {
  name: string
  entity: 'clients' | 'opportunities' | 'quotes'
  filters: string | null
  sort?: string | null
  isShared?: boolean
}): Promise<SavedView> {
  const res = await request<{ view: SavedView }>('/saved-views', { method: 'POST', body: JSON.stringify(data) })
  return res.view
}

export async function updateSavedView(id: string, data: Partial<{ name: string; filters: string | null; isShared: boolean; sort: string | null }>): Promise<SavedView> {
  const res = await request<{ view: SavedView }>(`/saved-views/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  return res.view
}

export async function deleteSavedView(id: string): Promise<void> {
  await request(`/saved-views/${id}`, { method: 'DELETE' })
}
