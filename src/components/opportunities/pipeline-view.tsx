'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { OpportunityFormDialog } from './opportunity-form-dialog'
import { TrendingUp, DollarSign, GripVertical } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

interface PipelineStage {
  id: string
  name: string
  order: number
  color: string
  opportunityCount: number
  totalValue: number
  avgProbability: number
  opportunities: Array<{
    id: string
    title: string
    interest: string
    estimatedValue: number
    probability: number
    nextAction?: string | null
    nextActionDate?: string | null
    client: { id: string; name: string; email?: string; phone?: string; temperature: string }
  }>
}

interface PipelineData {
  stages: PipelineStage[]
  summary: { totalStages: number; totalOpportunities: number; totalPipelineValue: number }
}

const tempColors: Record<string, string> = {
  Frio: 'bg-slate-100 text-slate-600',
  Tibio: 'bg-amber-50 text-amber-700',
  Caliente: 'bg-orange-50 text-orange-700',
  Fuego: 'bg-red-50 text-red-700',
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v)

export function PipelineView() {
  const { setView, setSelectedClientId } = useAppStore()
  const [data, setData] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [draggedOppId, setDraggedOppId] = useState<string | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)

  const loadPipeline = useCallback(async () => {
    try {
      const result = await api.getPipeline()
      setData(result as PipelineData)
    } catch {
      toast.error('Error al cargar pipeline')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPipeline()
  }, [loadPipeline])

  const handleStageChange = async (opportunityId: string, newStageId: string) => {
    try {
      await api.updateOpportunity(opportunityId, { stageId: newStageId })
      toast.success('Oportunidad movida')
      loadPipeline()
    } catch {
      toast.error('Error al mover oportunidad')
    }
  }

  // Drag & Drop handlers
  const handleDragStart = (e: React.DragEvent, oppId: string) => {
    setDraggedOppId(oppId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', oppId)
    // Add a slight delay to apply drag styles
    const target = e.target as HTMLElement
    setTimeout(() => {
      target.style.opacity = '0.5'
    }, 0)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedOppId(null)
    setDragOverStageId(null)
    const target = e.target as HTMLElement
    target.style.opacity = '1'
  }

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStageId(stageId)
  }

  const handleDragLeave = () => {
    setDragOverStageId(null)
  }

  const handleDrop = (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault()
    setDragOverStageId(null)

    const oppId = e.dataTransfer.getData('text/plain')
    if (!oppId || !targetStageId) return

    // Find the opportunity's current stage to avoid unnecessary updates
    if (data) {
      const currentStage = data.stages.find(s =>
        s.opportunities.some(o => o.id === oppId)
      )
      if (currentStage && currentStage.id === targetStageId) return
    }

    handleStageChange(oppId, targetStageId)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-96 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pipeline de Ventas</h1>
          <p className="text-sm text-slate-500 mt-1">
            {data.summary.totalOpportunities} oportunidades · {formatCurrency(data.summary.totalPipelineValue)} en pipeline
          </p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <TrendingUp className="w-4 h-4 mr-2" /> Nueva Oportunidad
        </Button>
      </div>

      {/* Drag & Drop Hint */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <GripVertical className="w-3.5 h-3.5" />
        <span>Arrastra las oportunidades entre columnas para cambiar su etapa</span>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {data.stages.map((stage) => {
          const isDragOver = dragOverStageId === stage.id
          return (
            <div
              key={stage.id}
              className={`flex-shrink-0 w-72 transition-all duration-200 ${
                isDragOver ? 'scale-[1.02]' : ''
              }`}
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.id)}
            >
              {/* Stage Header */}
              <div
                className={`rounded-t-xl p-3 border border-b-0 transition-colors duration-200 ${
                  isDragOver ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'
                }`}
                style={{ borderTop: `3px solid ${isDragOver ? '#059669' : stage.color}` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{stage.name}</h3>
                    <Badge variant="secondary" className="text-xs">{stage.opportunityCount}</Badge>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {formatCurrency(stage.totalValue)} · {stage.avgProbability}% prob. prom.
                </p>
              </div>

              {/* Opportunity Cards - Drop Zone */}
              <div
                className={`border rounded-b-xl p-2 space-y-2 min-h-[120px] transition-colors duration-200 ${
                  isDragOver
                    ? 'bg-emerald-50/50 border-emerald-300 border-dashed'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <AnimatePresence>
                  {stage.opportunities.length > 0 ? (
                    stage.opportunities.map((opp) => (
                      <motion.div
                        key={opp.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        draggable
                        onDragStart={(e) => handleDragStart(e as any, opp.id)}
                        onDragEnd={() => { setDraggedOppId(null); setDragOverStageId(null) }}
                        className={`bg-white p-3 rounded-lg shadow-sm border border-slate-100 cursor-grab hover:shadow-md transition-all active:cursor-grabbing ${
                          draggedOppId === opp.id ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <GripVertical className="w-3.5 h-3.5 text-slate-300 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between mb-2">
                              <p className="text-sm font-medium text-slate-900 line-clamp-1">{opp.title}</p>
                              <Badge className={`text-[10px] ml-1 ${tempColors[opp.client.temperature] ?? ''}`}>
                                {opp.client.temperature}
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-500 mb-2">{opp.client.name}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-emerald-600">{formatCurrency(opp.estimatedValue)}</span>
                              <span className="text-xs text-slate-400">{opp.probability}%</span>
                            </div>
                            {opp.nextAction && (
                              <p className="text-xs text-slate-400 mt-2 truncate">📌 {opp.nextAction}</p>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))
                  ) : (
                    <div className={`text-center py-8 text-xs ${
                      isDragOver ? 'text-emerald-600 font-medium' : 'text-slate-400'
                    }`}>
                      {isDragOver ? 'Soltar aquí' : 'Sin oportunidades'}
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )
        })}
      </div>

      {/* Opportunity Form */}
      <OpportunityFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); loadPipeline() }}
      />
    </div>
  )
}
