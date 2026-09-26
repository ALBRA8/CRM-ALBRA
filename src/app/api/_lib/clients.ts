import { db } from '@/lib/db'
import { parseJson, str } from './shared'

/**
 * Atributos extendidos del cliente (company, city, tags, temperature) que no
 * tienen columna propia en el schema. Se persisten como CustomFieldValue de
 * sistema (CustomField entity=client name=<attr>) para no tocar el schema.
 * `cedula` (identifier) sí tiene columna y no pasa por aquí.
 */

export const CLIENT_ATTR_DEFS: Array<{ name: string; label: string; type: string; options?: string }> = [
  { name: 'temperature', label: 'Temperatura', type: 'select', options: '["Frio","Tibio","Caliente","Fuego"]' },
  { name: 'company', label: 'Empresa', type: 'text' },
  { name: 'city', label: 'Ciudad', type: 'text' },
  { name: 'tags', label: 'Tags', type: 'text' },
]

export const CLIENT_ATTR_KEYS = CLIENT_ATTR_DEFS.map((d) => d.name)

export type ClientAttrs = {
  temperature?: string | null
  company?: string | null
  city?: string | null
  tags?: string[] | null
}

/** Garantiza que la org tenga los CustomField de sistema y devuelve name→fieldId. */
export async function ensureClientAttrFields(orgId: string): Promise<Map<string, string>> {
  const existing = await db.customField.findMany({
    where: { organizationId: orgId, entity: 'client', name: { in: CLIENT_ATTR_KEYS } },
    select: { id: true, name: true },
  })
  const map = new Map(existing.map((f) => [f.name, f.id]))
  for (const def of CLIENT_ATTR_DEFS) {
    if (!map.has(def.name)) {
      const created = await db.customField.create({
        data: {
          organizationId: orgId,
          entity: 'client',
          name: def.name,
          label: def.label,
          type: def.type,
          options: def.options ?? null,
          isRequired: false,
          order: 90,
        },
        select: { id: true, name: true },
      })
      map.set(created.name, created.id)
    }
  }
  return map
}

/** Guarda/elimina los valores de atributos extendidos de un cliente. */
export async function saveClientAttrs(orgId: string, clientId: string, body: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(body).filter((k) => CLIENT_ATTR_KEYS.includes(k))
  if (keys.length === 0) return
  const fieldMap = await ensureClientAttrFields(orgId)
  for (const key of keys) {
    const fieldId = fieldMap.get(key)
    if (!fieldId) continue
    const raw = body[key]
    let value: string | null
    if (key === 'tags') {
      const arr = Array.isArray(raw) ? raw.map((t) => String(t).trim()).filter(Boolean) : null
      value = arr ? JSON.stringify(arr) : str(raw)
    } else {
      value = str(raw)
    }
    if (value === null) {
      await db.customFieldValue.deleteMany({ where: { organizationId: orgId, fieldId, entityId: clientId } })
    } else {
      await db.customFieldValue.upsert({
        where: { fieldId_entityId: { fieldId, entityId: clientId } },
        create: { organizationId: orgId, fieldId, entityType: 'client', entityId: clientId, value },
        update: { value },
      })
    }
  }
}

/** Carga en bloque los atributos extendidos de varios clientes. */
export async function loadClientAttrs(orgId: string, clientIds: string[]): Promise<Map<string, ClientAttrs>> {
  const result = new Map<string, ClientAttrs>()
  if (clientIds.length === 0) return result
  const values = await db.customFieldValue.findMany({
    where: {
      organizationId: orgId,
      entityType: 'client',
      entityId: { in: clientIds },
      field: { name: { in: CLIENT_ATTR_KEYS } },
    },
    select: { entityId: true, value: true, field: { select: { name: true } } },
  })
  for (const v of values) {
    const attrs = (result.get(v.entityId) ?? {}) as Record<string, unknown>
    if (v.field.name === 'tags') {
      const parsed = parseJson<string[] | null>(v.value, null)
      attrs.tags = parsed ?? (v.value ? v.value.split(',').map((t) => t.trim()).filter(Boolean) : null)
    } else {
      attrs[v.field.name] = v.value
    }
    result.set(v.entityId, attrs)
  }
  return result
}

/** Temperatura heurística basada en recencia de contacto (fallback si no está almacenada). */
export function computeTemperature(lastContactAt: Date | null, createdAt: Date): string {
  const base = lastContactAt ?? createdAt
  const days = Math.floor((Date.now() - base.getTime()) / 86_400_000)
  if (days <= 2) return 'Fuego'
  if (days <= 7) return 'Caliente'
  if (days <= 21) return 'Tibio'
  return 'Frio'
}

/** Score de cliente 0-100 (recencia + estado + oportunidades abiertas + datos de contacto). */
export function computeScore(input: {
  status: string
  lastContactAt: Date | null
  createdAt: Date
  email?: string | null
  openOpportunities: number
}): number {
  let score = 10
  const base = input.lastContactAt ?? input.createdAt
  const days = Math.floor((Date.now() - base.getTime()) / 86_400_000)
  if (days <= 3) score += 35
  else if (days <= 7) score += 28
  else if (days <= 14) score += 20
  else if (days <= 30) score += 12
  if (input.status === 'active') score += 25
  else if (input.status === 'prospect') score += 15
  score += Math.min(20, input.openOpportunities * 10)
  if (input.email) score += 5
  return Math.max(0, Math.min(100, score))
}

interface ClientRecordLike {
  id: string
  name: string
  email: string | null
  phone: string | null
  cedula: string | null
  address: string | null
  notes: string | null
  status: string
  source: string | null
  lastContactAt: Date | null
  createdAt: Date
  updatedAt: Date
  _count?: { opportunities: number; reservations: number }
}

/** Serializa un cliente al shape que consumen clients-list / client-detail. */
export function serializeClient(
  client: ClientRecordLike,
  attrs: ClientAttrs | undefined,
  opts?: { openOpportunities?: number; includeCount?: boolean }
): Record<string, unknown> {
  const temperature = attrs?.temperature || computeTemperature(client.lastContactAt, client.createdAt)
  const openOpps = opts?.openOpportunities ?? client._count?.opportunities ?? 0
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone,
    identifier: client.cedula,
    cedula: client.cedula,
    company: attrs?.company ?? null,
    city: attrs?.city ?? null,
    address: client.address,
    notes: client.notes,
    status: client.status,
    source: client.source ?? 'manual',
    temperature,
    score: computeScore({
      status: client.status,
      lastContactAt: client.lastContactAt,
      createdAt: client.createdAt,
      email: client.email,
      openOpportunities: openOpps,
    }),
    tags: attrs?.tags ?? null,
    lastContactAt: client.lastContactAt,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    ...(opts?.includeCount === false ? {} : { _count: client._count ?? { opportunities: 0, reservations: 0 } }),
  }
}

/** Cliente mínimo para respuestas anidadas (cotizaciones, pipeline, etc.). */
export function serializeClientRef(
  client: { id: string; name: string; email: string | null; phone: string | null; address?: string | null } | null,
  attrs?: ClientAttrs
): Record<string, unknown> | null {
  if (!client) return null
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone,
    company: attrs?.company ?? null,
    city: attrs?.city ?? null,
    address: client.address ?? null,
    temperature: attrs?.temperature || 'Frio',
  }
}
