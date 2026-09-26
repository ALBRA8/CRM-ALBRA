'use client'

/**
 * Timeline unificado del cliente (estilo Twenty CRM) — Feature A, Task 2-c.
 * Consume GET /api/timeline?clientId=<id>&limit=50 con fetch directo
 * (misma convención de auth que src/lib/api.ts: Bearer en memoria + cookie httpOnly).
 * Incluye input rápido "Añadir nota" vía api.addClientHistory.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  StickyNote,
  Phone,
  Calendar,
  MessageCircle,
  Send,
  Instagram,
  Mail,
  FileText,
  ArrowRightLeft,
  Banknote,
  Cog,
  Activity,
  Plus,
  Loader2,
  History,
} from 'lucide-react'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'

interface TimelineEvent {
  id: string
  type: string
  title: string
  description?: string | null
  source: string
  metadata?: string | null
  createdAt: string
}

// ─── Config visual por tipo de evento ────────────────────────────────────────

const typeIcons: Record<string, React.ReactNode> = {
  note: <StickyNote className="w-3 h-3" />,
  call: <Phone className="w-3 h-3" />,
  meeting: <Calendar className="w-3 h-3" />,
  whatsapp: <MessageCircle className="w-3 h-3" />,
  telegram: <Send className="w-3 h-3" />,
  instagram: <Instagram className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
  quote: <FileText className="w-3 h-3" />,
  stage_change: <ArrowRightLeft className="w-3 h-3" />,
  transaction: <Banknote className="w-3 h-3" />,
  system: <Cog className="w-3 h-3" />,
}

const typeLabels: Record<string, string> = {
  note: 'Nota',
  call: 'Llamada',
  meeting: 'Reunión',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  instagram: 'Instagram',
  email: 'Email',
  quote: 'Cotización',
  stage_change: 'Etapa',
  transaction: 'Transacción',
  system: 'Sistema',
}

// Color por source: agent=violeta, automation=ámbar, integration=sky, manual=slate
const sourceDotColors: Record<string, string> = {
  agent: 'bg-violet-500',
  automation: 'bg-amber-500',
  integration: 'bg-sky-500',
  manual: 'bg-slate-400',
}

const sourceBadgeColors: Record<string, string> = {
  agent: 'bg-violet-50 text-violet-700 border-violet-200',
  automation: 'bg-amber-50 text-amber-700 border-amber-200',
  integration: 'bg-sky-50 text-sky-700 border-sky-200',
  manual: 'bg-slate-100 text-slate-600 border-slate-200',
}

const sourceLabels: Record<string, string> = {
  agent: 'Agente IA',
  automation: 'Automatización',
  integration: 'Integración',
  manual: 'Manual',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMetadata(metadata: string | null | undefined): Array<[string, string]> {
  if (!metadata) return []
  try {
    const parsed = JSON.parse(metadata)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed)
        .slice(0, 3)
        .map(([k, v]) => [k, String(v)])
    }
    return [['info', String(parsed)]]
  } catch {
    return [['info', String(metadata)]]
  }
}

function groupLabel(date: Date): string {
  if (isToday(date)) return 'Hoy'
  if (isYesterday(date)) return 'Ayer'
  const formatted = format(date, "d 'de' MMMM yyyy", { locale: es })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface ClientTimelineProps {
  clientId: string
}

export function ClientTimeline({ clientId }: ClientTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const noteInputRef = useRef<HTMLInputElement>(null)

  const loadTimeline = useCallback(async () => {
    try {
      setLoading(true)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (typeof window !== 'undefined') {
        const token = api.getToken()
        if (token) headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`/api/timeline?clientId=${encodeURIComponent(clientId)}&limit=50`, { headers })
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Error de conexión' }))
        throw new Error(error.error || `Error ${res.status}`)
      }
      const data = await res.json()
      const list = (data.events as TimelineEvent[]) ?? []
      // Ordenar desc por createdAt (defensivo)
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setEvents(list)
    } catch {
      toast.error('Error al cargar el historial')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  const handleAddNote = async () => {
    const text = noteText.trim()
    if (!text) {
      toast.error('Escribe una nota antes de agregar')
      noteInputRef.current?.focus()
      return
    }
    try {
      setAddingNote(true)
      await api.addClientHistory(clientId, { serviceType: 'nota', description: text, amount: null })
      toast.success('Nota agregada')
      setNoteText('')
      loadTimeline()
    } catch {
      toast.error('Error al agregar la nota')
    } finally {
      setAddingNote(false)
    }
  }

  // Agrupar por día (Hoy / Ayer / fecha)
  const groups = events.reduce<Record<string, TimelineEvent[]>>((acc, ev) => {
    const key = groupLabel(new Date(ev.createdAt))
    if (!acc[key]) acc[key] = []
    acc[key].push(ev)
    return acc
  }, {})

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="w-5 h-5 text-emerald-600" /> Historial Unificado
          {!loading && events.length > 0 && (
            <Badge variant="secondary" className="text-xs font-normal">{events.length} eventos</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Input rápido: Añadir nota */}
        <div className="flex gap-2 mb-6">
          <Input
            ref={noteInputRef}
            placeholder="Añadir nota rápida… (ej: Le interesa el plan premium)"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !addingNote) handleAddNote() }}
            disabled={addingNote}
            aria-label="Nueva nota rápida"
            className="h-9 text-sm"
          />
          <Button
            onClick={handleAddNote}
            disabled={addingNote || !noteText.trim()}
            className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-sm gap-1"
          >
            {addingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Nota
          </Button>
        </div>

        {loading ? (
          <div className="space-y-4" role="status" aria-label="Cargando historial">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Aún no hay actividad para este cliente</p>
            <p className="text-xs text-slate-300 mt-1">
              Las llamadas, mensajes, notas y cotizaciones aparecerán aquí en un solo lugar
            </p>
          </div>
        ) : (
          <div className="max-h-[560px] overflow-y-auto pr-1" aria-label="Línea de tiempo del cliente">
            {Object.entries(groups).map(([label, groupEvents]) => (
              <div key={label} className="mb-6 last:mb-0">
                <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3 sticky top-0 bg-white py-1 z-10">
                  {label}
                </h4>
                <div className="relative">
                  {/* Línea vertical */}
                  <div className="absolute left-[13px] top-2 bottom-2 w-0.5 bg-slate-100" aria-hidden="true" />
                  <div className="space-y-0">
                    <AnimatePresence>
                      {groupEvents.map((ev) => {
                        const dotColor = sourceDotColors[ev.source] ?? 'bg-slate-300'
                        const badgeColor = sourceBadgeColors[ev.source] ?? 'bg-slate-100 text-slate-600 border-slate-200'
                        const icon = typeIcons[ev.type] ?? <Activity className="w-3 h-3" />
                        const metaEntries = parseMetadata(ev.metadata)
                        return (
                          <motion.div
                            key={ev.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex gap-3 pb-4 relative last:pb-0"
                          >
                            {/* Punto con icono por tipo, color por source */}
                            <div
                              className={`w-7 h-7 rounded-full ${dotColor} text-white flex items-center justify-center flex-shrink-0 z-10 ring-2 ring-white`}
                              aria-hidden="true"
                            >
                              {icon}
                            </div>
                            <div className="flex-1 min-w-0 bg-white border border-slate-100 rounded-lg p-3 shadow-sm hover:border-slate-200 transition-colors">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-slate-900">{ev.title}</p>
                                <Badge variant="outline" className={`text-[10px] ${badgeColor}`}>
                                  {sourceLabels[ev.source] ?? ev.source}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] font-normal text-slate-400">
                                  {typeLabels[ev.type] ?? ev.type}
                                </Badge>
                                <span className="text-[11px] text-slate-400 ml-auto flex-shrink-0">
                                  {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true, locale: es })}
                                </span>
                              </div>
                              {ev.description && (
                                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words">{ev.description}</p>
                              )}
                              {metaEntries.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {metaEntries.map(([k, v]) => (
                                    <span
                                      key={k}
                                      className="text-[10px] bg-slate-50 border border-slate-100 text-slate-400 rounded px-1.5 py-0.5 max-w-full truncate"
                                    >
                                      {k}: {v}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <p className="text-[10px] text-slate-300 mt-1.5 sm:hidden">
                                {format(new Date(ev.createdAt), "d MMM, HH:mm", { locale: es })}
                              </p>
                            </div>
                          </motion.div>
                        )
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
