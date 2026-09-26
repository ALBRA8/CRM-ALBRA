import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, HttpError } from '@/lib/auth'
import { auditAndTimeline } from '@/lib/api-helpers'
import { handle, json, readBody, str, parseJson, isObjArray } from '../../../_lib/shared'

/**
 * Preferencias del cliente como lista category/key/value.
 * El modelo ClientPreferences tiene una fila por cliente; la lista se guarda
 * como JSON en la columna `notes`.
 */

interface PrefEntry {
  id: string
  category: string
  key: string
  value: string
}

function readPrefs(raw: string | null): Array<Omit<PrefEntry, 'id'>> {
  const parsed = parseJson<Array<{ category?: string; key?: string; value?: string }>>(raw, [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((p) => str(p.category) && str(p.key))
    .map((p) => ({ category: str(p.category) as string, key: str(p.key) as string, value: str(p.value) ?? '' }))
}

function withIds(prefs: Array<Omit<PrefEntry, 'id'>>): PrefEntry[] {
  return prefs.map((p, i) => ({ id: `pref-${i + 1}`, ...p }))
}

async function requireClient(orgId: string, clientId: string) {
  const client = await db.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true, name: true } })
  if (!client) throw new HttpError(404, 'Cliente no encontrado')
  return client
}

/** GET /api/clients/:id/preferences */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    await requireClient(auth.orgId, id)

    const prefs = await db.clientPreferences.findFirst({ where: { organizationId: auth.orgId, clientId: id } })
    return json({ preferences: withIds(readPrefs(prefs?.notes ?? null)) })
  })
}

/**
 * PUT /api/clients/:id/preferences — el frontend envía un array de
 * { category, key, value }; se fusiona con las existentes (mismo category+key
 * se reemplaza). También acepta objeto con preferredChannel/preferredTime/interests.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = requireAuth(req)
    const { id } = await params
    const client = await requireClient(auth.orgId, id)
    const body = await readBody(req)

    const existingRow = await db.clientPreferences.findFirst({ where: { organizationId: auth.orgId, clientId: id } })
    let prefs = readPrefs(existingRow?.notes ?? null)

    // Columnas fijas del modelo (forma alternativa del contrato)
    const fixed: Record<string, string | null> = {
      preferredChannel: existingRow?.preferredChannel ?? null,
      preferredTime: existingRow?.preferredTime ?? null,
      interests: existingRow?.interests ?? null,
    }
    let fixedDirty = false
    for (const key of Object.keys(fixed)) {
      if (key in body) {
        fixed[key] = str(body[key])
        fixedDirty = true
        prefs = prefs.filter((p) => !(p.category === 'contacto' && p.key === key))
        if (fixed[key]) prefs.push({ category: 'contacto', key, value: fixed[key] as string })
      }
    }

    // Forma principal: array de { category, key, value }
    const entries = isObjArray(body) ? body : isObjArray(body.preferences) ? body.preferences : []
    for (const entry of entries) {
      const category = str(entry.category)
      const key = str(entry.key)
      const value = str(entry.value) ?? ''
      if (!category || !key) continue
      prefs = prefs.filter((p) => !(p.category === category && p.key === key))
      prefs.push({ category, key, value })
    }

    await db.clientPreferences.upsert({
      where: { clientId: id },
      create: {
        organizationId: auth.orgId,
        clientId: id,
        notes: JSON.stringify(prefs),
        preferredChannel: fixed.preferredChannel,
        preferredTime: fixed.preferredTime,
      },
      update: {
        notes: JSON.stringify(prefs),
        ...(fixedDirty ? { preferredChannel: fixed.preferredChannel, preferredTime: fixed.preferredTime } : {}),
      },
    })
    await auditAndTimeline({
      orgId: auth.orgId,
      userId: auth.userId,
      action: 'updated',
      entity: 'client',
      entityId: id,
      details: { name: client.name, field: 'preferences' },
    })

    return json({ preferences: withIds(prefs) })
  })
}
