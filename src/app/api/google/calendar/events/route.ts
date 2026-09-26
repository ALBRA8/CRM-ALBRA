import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { handle, json, requireFields } from '@/lib/api-helpers'
import { getAccessToken, googleApi } from '@/lib/google'
import { recordTimelineEvent } from '@/lib/timeline'

/**
 * GET  /api/google/calendar/events — lista próximos eventos (graceful: { connected:false, events:[] })
 * POST /api/google/calendar/events — crea un evento { title, startsAt, endsAt?, description?, location? }
 */
interface GEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  hangoutLink?: string
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const accessToken = await getAccessToken(auth.orgId)
    if (!accessToken) return json({ connected: false, events: [], note: 'Google Calendar no conectado' })

    const timeMin = new Date().toISOString()
    const data = await googleApi<{ items?: GEvent[] }>(
      accessToken,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&maxResults=25&singleEvents=true&orderBy=startTime`
    )
    if (!data) return json({ connected: true, events: [], note: 'Calendar API no disponible en este momento' })

    const events = (data.items || []).map((e) => ({
      id: e.id,
      title: e.summary || '(sin título)',
      description: e.description || null,
      location: e.location || null,
      startsAt: e.start?.dateTime || (e.start?.date ? `${e.start.date}T00:00:00` : null),
      endsAt: e.end?.dateTime || null,
      meetLink: e.hangoutLink || null,
    }))
    return json({ connected: true, events })
  })
}

interface CalendarEventBody {
  title?: string
  startsAt?: string
  endsAt?: string
  description?: string
  location?: string
  clientId?: string
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const auth = requireAuth(req)
    const body = (await req.json().catch(() => ({}))) as CalendarEventBody
    requireFields(body as unknown as Record<string, unknown>, ['title', 'startsAt'])
    const startsAt = new Date(String(body.startsAt))
    if (Number.isNaN(startsAt.getTime())) return json({ error: 'startsAt inválido (ISO 8601)' }, { status: 400 })
    const endsAt = body.endsAt ? new Date(String(body.endsAt)) : new Date(startsAt.getTime() + 60 * 60 * 1000)

    const accessToken = await getAccessToken(auth.orgId)
    if (!accessToken) {
      return json({ error: 'Google Calendar no conectado. Conecta tu cuenta en Configuración → Google.' }, { status: 400 })
    }

    const created = await googleApi<GEvent>(accessToken, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify({
        summary: String(body.title).slice(0, 200),
        description: body.description ? String(body.description).slice(0, 2000) : undefined,
        location: body.location ? String(body.location).slice(0, 300) : undefined,
        start: { dateTime: startsAt.toISOString() },
        end: { dateTime: endsAt.toISOString() },
      }),
    })

    if (!created?.id) {
      return json({ queued: true, note: 'Calendar API no pudo crear el evento. Queda registrado localmente.' })
    }

    await recordTimelineEvent({
      orgId: auth.orgId,
      clientId: body.clientId || null,
      type: 'meeting',
      title: `Evento creado en Google Calendar: ${body.title}`,
      description: startsAt.toLocaleString('es-CO'),
      metadata: { googleEventId: created.id, channel: 'google' },
      source: 'integration',
      userId: auth.userId,
    })
    return json({ success: true, event: { id: created.id, title: body.title, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } })
  })
}
