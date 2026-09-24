'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { AutomationFormDialog } from './automation-form-dialog'
import { SuggestionsPanel } from './suggestions-panel'
import { Plus, Play, Zap, Clock, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'

interface Automation {
  id: string
  name: string
  type: string
  trigger: string
  conditions?: string | null
  actions: string
  message?: string | null
  isActive: boolean
  lastRunAt?: string | null
  runCount: number
  createdAt: string
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
      const result = await api.runAutomations()
      toast.success(`Automatizaciones ejecutadas: ${(result.results as { remindersSent: number; inactiveRecovered: number; loyaltyFollowUps: number }).remindersSent} recordatorios, ${(result.results as { inactiveRecovered: number }).inactiveRecovered} recuperaciones`)
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
            {runningAll ? 'Ejecutando...' : 'Ejecutar Todas'}
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
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className={`w-4 h-4 ${auto.isActive ? 'text-emerald-500' : 'text-slate-300'}`} />
                        <h3 className="text-sm font-semibold text-slate-900 truncate">{auto.name}</h3>
                        <Badge className={`text-xs ${typeColors[auto.type] ?? 'bg-slate-100 text-slate-600'}`}>
                          {typeLabels[auto.type] ?? auto.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Trigger: {triggerLabels[auto.trigger] ?? auto.trigger}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {auto.lastRunAt
                            ? `Última: ${format(new Date(auto.lastRunAt), "d MMM, HH:mm", { locale: es })}`
                            : 'Sin ejecutar'}
                        </span>
                        <span>Ejecuciones: {auto.runCount}</span>
                      </div>
                      {auto.message && (
                        <p className="text-xs text-slate-400 mt-1 bg-slate-50 p-2 rounded line-clamp-2">
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
