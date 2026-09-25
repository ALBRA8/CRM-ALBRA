import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { db } from '@/lib/db'

const ENTITIES = ['clients', 'opportunities', 'quotes', 'reservations', 'transactions']

function serializeFilterValue(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * GET /api/saved-views?entity= — vistas propias + compartidas de la organización
 * POST /api/saved-views        — crea una vista { name, entity, filters, sort, isShared }
 *   filters: JSON string o array [{ field, operator: equals|contains|gt|lt|in|not_empty, value }]
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const entity = new URL(req.url).searchParams.get('entity') || undefined
    const views = await db.savedView.findMany({
      where: {
        organizationId: auth.orgId,
        ...(entity ? { entity } : {}),
        OR: [{ userId: auth.userId }, { isShared: true }, { userId: null }],
      },
      orderBy: { createdAt: 'asc' },
    })
    return json({ views })
  })
}

interface SavedViewBody {
  name?: string
  entity?: string
  filters?: unknown
  sort?: unknown
  isShared?: boolean
  isDefault?: boolean
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as SavedViewBody
    requireFields(body as unknown as Record<string, unknown>, ['name', 'entity'])
    if (!ENTITIES.includes(String(body.entity))) {
      return json({ error: `entity debe ser una de: ${ENTITIES.join(', ')}` }, { status: 400 })
    }

    // Normaliza filters a JSON string (array de { field, operator, value })
    let filtersJson: string | null = null
    if (Array.isArray(body.filters)) {
      filtersJson = JSON.stringify(
        body.filters.map((f) => {
          const item = f as Record<string, unknown>
          return { field: String(item.field ?? ''), operator: String(item.operator ?? 'equals'), value: serializeFilterValue(item.value) }
        })
      )
    } else if (typeof body.filters === 'string' && body.filters.trim()) {
      try {
        const parsed = JSON.parse(body.filters)
        filtersJson = Array.isArray(parsed) ? JSON.stringify(parsed) : JSON.stringify([parsed])
      } catch {
        return json({ error: 'filters debe ser JSON válido' }, { status: 400 })
      }
    }

    let sortJson: string | null = null
    if (body.sort && typeof body.sort === 'object') {
      sortJson = JSON.stringify(body.sort)
    } else if (typeof body.sort === 'string' && body.sort.trim()) {
      sortJson = body.sort
    }

    const view = await db.savedView.create({
      data: {
        organizationId: auth.orgId,
        userId: auth.userId,
        name: String(body.name).slice(0, 120),
        entity: String(body.entity),
        filters: filtersJson,
        sort: sortJson,
        isShared: !!body.isShared,
        isDefault: !!body.isDefault,
      },
    })
    return json({ view }, { status: 201 })
  })
}
