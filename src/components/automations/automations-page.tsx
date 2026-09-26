'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { AutomationFormDialog, triggerTypeLabels } from './automation-form-dialog'
import { SuggestionsPanel } from './suggestions-panel'
import { Plus, Play, Zap, Clock, RefreshCw, CheckCircle2, XCircle, Hourglass, ChevronDown, ChevronRight, Bot } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'

interface LastRunStep {
  type: string
  status: string
  error?: string
  ms?: number
}

interface LastRun {
  status: string
  error: string | null
  startedAt: string
  finishedAt: string | null
  resumeAt: string | null
  currentStep: number
  steps: LastRunStep[]
}

interface Automation {
  id: string
  name: string
  type: string
  trigger?: string | null
  triggerType?: string | null
  triggerConfig?: string | null
  conditions?: string | null
  actions: string
  message?: string | null
  isActive: boolean
  lastRunAt?: string | null
  runCount: number
  createdAt: string
  lastRun?: LastRun | null
}

const stepTypeLabels: Record<string, string> = {
  notify_admin: 'Notificar admin',
  send_whatsapp: 'Enviar WhatsApp',
  send_telegram: 'Enviar Telegram',
  send_email: 'Enviar email',
  create_opportunity: 'Crear oportunidad',
  update_client_status: 'Actualizar cliente',
  move_opportunity_stage: 'Mover etapa',
  create_task_like_notification: 'Crear tarea',
  ai_followup: 'Seguimiento IA',
  wait: 'Esperar',
  send_message: 'Enviar mensaje',
}

const typeColors: Record<string, string> = {
  reminder: 'bg-emerald-100 text-emerald-700',
  inactive_recovery: 'bg-amber-100 text-amber-700',
  loyalty: 'bg-violet-100 text-violet-700',
  follow_up: 'bg-sky-100 text-sky-700',
  custom: 'bg-slate-100 text-slate-600',
}

const typeLabels: Record<string, string> = {
  reminder: 'Recordatorio',
  inactive_recovery: 'Recuperación',
  loyalty: 'Fidelización',
  follow_up: 'Seguimiento',
  custom: 'Personalizada',
}

const triggerLabels: Record<string, string> = {
  days_inactive: 'Días sin contacto',
  before_appointment: 'Antes de cita',
  after_service: 'Después del servicio',
  stage_change: 'Cambio de etapa',
}

// Parseo tolerante de condiciones/acciones guardadas como JSON string
function countJsonArray(json: string | null | undefined): number {
  if (!json) return 0
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed.length
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length
    return 0
  } catch {
    return 0
  }
}

/** Badge de la última ejecución (estado del run más reciente). */
function LastRunBadge({ lastRun }: { lastRun?: LastRun | null }) {
  if (!lastRun) return null
  if (lastRun.status === 'waiting') {
    const resume = lastRun.resumeAt
      ? `reanuda ${format(new Date(lastRun.resumeAt), "d MMM HH:mm", { locale: es })}`
      : 'en espera'
    return (
      <Badge variant="outline" className="text-[10px] bg-amber-50/60 text-amber-700 border-amber-200 gap-1">
        <Hourglass className="w-2.5 h-2.5" /> En espera ({resume})
      </Badge>
    )
  }
  if (lastRun.status === 'failed') {
    return (
      <Badge variant="outline" className="text-[10px] bg-red-50/60 text-red-700 border-red-200 gap-1">
        <XCircle className="w-2.5 h-2.5" /> Falló
      </Badge>
    )
  }
  if (lastRun.status === 'success') {
    return (
      <Badge variant="outline" className="text-[10px] bg-emerald-50/60 text-emerald-700 border-emerald-200 gap-1">
        <CheckCircle2 className="w-2.5 h-2.5" /> Exitosa
      </Badge>
    )
  }
  return null
}

/** Detalle expandible de pasos de la última ejecución. */
function LastRunSteps({ lastRun }: { lastRun: LastRun }) {
  const [open, setOpen] = useState(false)
  if (lastRun.steps.length === 0 && lastRun.status !== 'failed') return null
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-[11px] text-slate-400 hover:text-emerald-700 flex items-center gap-1 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Detalle de la última ejecución
      </button>
      {open && (
        <div className="mt-1.5 bg-slate-50 border border-slate-100 rounded-lg p-2.5 space-y-1.5">
          {lastRun.steps.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px]">
              {s.status === 'success' ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
              ) : s.status === 'waiting' ? (
                <Hourglass className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
              )}
              <span className="text-slate-600 font-medium">{i + 1}. {stepTypeLabels[s.type] ?? s.type}</span>
              {typeof s.ms === 'number' && s.status === 'success' && (
                <span className="text-slate-400">({s.ms} ms)</span>
              )}
              {s.error && <span className="text-red-500 truncate" title={s.error}>— {s.error}</span>}
            </div>
          ))}
          {lastRun.steps.length === 0 && (
            <p className="text-[11px] text-slate-400">Sin detalle de pasos (ejecución antigua)</p>
          )}
          {lastRun.error && (
            <p className="text-[11px] text-red-600 border-t border-slate-200 pt-1.5">Error: {lastRun.error}</p>
          )}
          {lastRun.status === 'success' && lastRun.steps.some((s) => s.type === 'ai_followup') && (
            <p className="text-[10px] text-violet-500 flex items-center gap-1 border-t border-slate-200 pt-1.5">
              <Bot className="w-3 h-3" /> El seguimiento redactado por IA quedó en tus notificaciones
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editAutomation, setEditAutomation] = useState<Automation | null>(null)
  const [runningAll, setRunningAll] = useState(false)

  const loadAutomations = useCallback(async () => {
    try {
      const data = await api.getAutomations()
      setAutomations(data.automations as Automation[])
    } catch {
      toast.error('Error al cargar automatizaciones')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAutomations()
  }, [loadAutomations])

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.updateAutomation(id, { isActive: !isActive })
      toast.success(isActive ? 'Automatización desactivada' : 'Automatización activada')
      loadAutomations()
    } catch {
      toast.error('Error al cambiar estado')
    }
  }

  const handleRunAll = async () => {
    setRunningAll(true)
    try {
      const result = await api.runAutomations() as { processed?: number; results?: { remindersSent: number; inactiveRecovered: number; loyaltyFollowUps: number } }
      if (typeof result?.processed === 'number') {
        toast.success(result.processed > 0
          ? `Ejecución completada: ${result.processed} automatización(es) procesada(s)`
          : 'No había automatizaciones pendientes por ejecutar', {
          description: result.processed > 0 ? 'Revisa el timeline de tus clientes para ver los efectos' : undefined,
        })
      } else if (result?.results) {
        toast.success(`Automatizaciones ejecutadas: ${result.results.remindersSent} recordatorios, ${result.results.inactiveRecovered} recuperaciones`)
      } else {
        toast.success('Ejecución completada')
      }
      loadAutomations()
    } catch {
      toast.error('Error al ejecutar automatizaciones')
    } finally {
      setRunningAll(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteAutomation(id)
      toast.success('Automatización eliminada')
      loadAutomations()
    } catch {
      toast.error('Error al eliminar')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Automatizaciones</h1>
          <p className="text-sm text-slate-500 mt-1">Configura acciones automáticas para tus clientes</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleRunAll}
            disabled={runningAll}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${runningAll ? 'animate-spin' : ''}`} />
            {runningAll ? 'Ejecutando...' : 'Ejecutar pendientes ahora'}
          </Button>
          <Button
            onClick={() => { setEditAutomation(null); setShowForm(true) }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" /> Nueva
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Automations List */}
        <div className="lg:col-span-2 space-y-4">
          {automations.length > 0 ? (
            automations.map((auto) => (
              <Card key={auto.id} className="border-0 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Zap className={`w-4 h-4 ${auto.isActive ? 'text-emerald-500' : 'text-slate-300'}`} />
                        <h3 className="text-sm font-semibold text-slate-900 truncate">{auto.name}</h3>
                        <Badge className={`text-xs ${typeColors[auto.type] ?? 'bg-slate-100 text-slate-600'}`}>
                          {typeLabels[auto.type] ?? auto.type}
                        </Badge>
                      </div>
                      {/* Trigger: nuevo formato (triggerType) o legacy (trigger) o Manual */}
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {auto.triggerType
                          ? (triggerTypeLabels[auto.triggerType] ?? auto.triggerType)
                          : auto.trigger
                            ? `Trigger: ${triggerLabels[auto.trigger] ?? auto.trigger}`
                            : 'Manual'}
                      </p>
                      {/* Métricas del workflow */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px] bg-emerald-50/60 text-emerald-700 border-emerald-200">
                          Ejecutada {auto.runCount} {auto.runCount === 1 ? 'vez' : 'veces'}
                        </Badge>
                        <LastRunBadge lastRun={auto.lastRun} />
                        {countJsonArray(auto.conditions) > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-amber-50/60 text-amber-700 border-amber-200">
                            {countJsonArray(auto.conditions)} condición(es)
                          </Badge>
                        )}
                        {countJsonArray(auto.actions) > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-violet-50/60 text-violet-700 border-violet-200">
                            {countJsonArray(auto.actions)} acción(es)
                          </Badge>
                        )}
                        <span className="text-xs text-slate-400 flex items-center gap-1 ml-1">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {auto.lastRunAt
                            ? `Última: ${formatDistanceToNow(new Date(auto.lastRunAt), { addSuffix: true, locale: es })}`
                            : 'Sin ejecutar'}
                        </span>
                      </div>
                      {auto.lastRun && <LastRunSteps lastRun={auto.lastRun} />}
                      {auto.message && (
                        <p className="text-xs text-slate-400 mt-2 bg-slate-50 p-2 rounded line-clamp-2">
                          &quot;{auto.message}&quot;
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <Switch
                        checked={auto.isActive}
                        onCheckedChange={() => handleToggleActive(auto.id, auto.isActive)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => { setEditAutomation(auto); setShowForm(true) }}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-red-500"
                        onClick={() => handleDelete(auto.id)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-12 text-center">
                <Zap className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-slate-600">No hay automatizaciones</h3>
                <p className="text-sm text-slate-400 mt-1">Crea tu primera automatización para ahorrar tiempo</p>
                <Button
                  onClick={() => setShowForm(true)}
                  className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" /> Crear Automatización
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Suggestions Panel */}
        <div>
          <SuggestionsPanel />
        </div>
      </div>

      {/* Automation Form Dialog */}
      <AutomationFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); loadAutomations() }}
        editAutomation={editAutomation}
      />
    </div>
  )
}
