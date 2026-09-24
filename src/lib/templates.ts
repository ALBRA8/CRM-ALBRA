/**
 * Helpers de plantillas compartidos entre las rutas /api/templates*.
 * El frontend usa `content`; el schema guarda `body` — se mapea en ambos sentidos.
 */

export const TEMPLATE_CHANNELS = ['whatsapp', 'telegram', 'instagram', 'email', 'sms', 'generic']

export function serializeTemplate(t: {
  id: string
  name: string
  channel: string
  subject: string | null
  body: string
  variables: string | null
  category: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: t.id,
    name: t.name,
    channel: t.channel,
    subject: t.subject,
    content: t.body,
    variables: t.variables,
    category: t.category,
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

/** variables: array del frontend ↔ JSON string del schema */
export function normalizeVariables(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return null
  let list: string[] = []
  if (Array.isArray(input)) {
    list = input.map((v) => String(v).trim()).filter(Boolean)
  } else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) list = parsed.map((v) => String(v).trim()).filter(Boolean)
      else return null
    } catch {
      list = input
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    }
  } else {
    return null
  }
  return list.length ? JSON.stringify(list) : null
}
