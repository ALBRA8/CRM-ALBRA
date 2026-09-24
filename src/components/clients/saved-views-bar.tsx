'use client'

/**
 * Barra de Vistas Guardadas (estilo Twenty CRM) — Feature B, Task 2-c.
 * Chips clicables para aplicar vistas + dialog "Guardar vista actual".
 * Reutilizable para entity='clients' (Clientes) y entity='opportunities' (Pipeline).
 */

import { useState, useEffect, useCallback } from 'react'
import {
  fetchSavedViews,
  createSavedView,
  deleteSavedView,
  parseViewFilters,
  describeFilter,
  type SavedView,
  type SavedViewFilter,
} from '@/lib/filters'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Bookmark, BookmarkPlus, X, Users, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface SavedViewsBarProps {
  entity: 'clients' | 'opportunities'
  activeViewId: string | null
  activeFilters: SavedViewFilter[]
  onApply: (view: SavedView | null) => void
  onFiltersChange: (filters: SavedViewFilter[]) => void
  /** Búsqueda actual del input de texto (se guarda como filtro contains sobre name). */
  currentSearch?: string
}

export function SavedViewsBar({ entity, activeViewId, activeFilters, onApply, onFiltersChange, currentSearch }: SavedViewsBarProps) {
  const [views, setViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog "Guardar vista actual"
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [viewName, setViewName] = useState('')
  const [shareWithTeam, setShareWithTeam] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadViews = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchSavedViews(entity)
      setViews(data)
    } catch {
      // Las vistas pueden no existir todavía (backend en despliegue) — fallo silencioso
    } finally {
      setLoading(false)
    }
  }, [entity])

  useEffect(() => {
    loadViews()
  }, [loadViews])

  const filtersToSave = (): SavedViewFilter[] => {
    const filters = [...activeFilters]
    if (currentSearch && currentSearch.trim()) {
      filters.push({ field: 'name', operator: 'contains', value: currentSearch.trim() })
    }
    return filters
  }

  const handleSaveView = async () => {
    const name = viewName.trim()
    if (!name) {
      toast.error('Ponle un nombre a la vista')
      return
    }
    try {
      setSaving(true)
      const filters = filtersToSave()
      const view = await createSavedView({
        name,
        entity,
        filters: filters.length > 0 ? JSON.stringify(filters) : null,
        isShared: shareWithTeam,
      })
      toast.success('Vista guardada', { description: shareWithTeam ? 'Visible para todo el equipo' : 'Visible solo para ti' })
      setShowSaveDialog(false)
      setViewName('')
      setShareWithTeam(false)
      await loadViews()
      onApply(view)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar la vista')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteView = async (e: React.MouseEvent | React.KeyboardEvent, viewId: string) => {
    e.stopPropagation()
    try {
      await deleteSavedView(viewId)
      toast.success('Vista eliminada')
      if (activeViewId === viewId) onApply(null)
      await loadViews()
    } catch {
      toast.error('Error al eliminar la vista')
    }
  }

  const handleKeyDownChip = (e: React.KeyboardEvent, view: SavedView) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onApply(view)
    }
  }

  const removeFilter = (index: number) => {
    const next = activeFilters.filter((_, i) => i !== index)
    onFiltersChange(next)
  }

  return (
    <div className="space-y-2">
      {/* Chips de vistas */}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Vistas guardadas">
        <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mr-0.5">
          <Bookmark className="w-3 h-3" aria-hidden="true" /> Vistas:
        </span>

        {/* Chip "Todas" */}
        <button
          type="button"
          onClick={() => onApply(null)}
          aria-pressed={activeFilters.length === 0}
          className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11px] border transition-colors ${
            activeFilters.length === 0
              ? 'bg-emerald-600 text-white border-emerald-600 font-medium'
              : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300 hover:text-emerald-700'
          }`}
        >
          Todas
        </button>

        {loading ? (
          <>
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </>
        ) : (
          views.map((view) => {
            const isActive = activeViewId === view.id
            return (
              <div
                key={view.id}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onClick={() => onApply(view)}
                onKeyDown={(e) => handleKeyDownChip(e, view)}
                className={`group inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] border cursor-pointer transition-colors select-none ${
                  isActive
                    ? 'bg-emerald-600 text-white border-emerald-600 font-medium'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-700'
                }`}
              >
                <Bookmark className={`w-3 h-3 ${isActive ? 'fill-white' : ''}`} aria-hidden="true" />
                <span className="max-w-[160px] truncate">{view.name}</span>
                {view.isShared && (
                  <Users className="w-2.5 h-2.5 opacity-60" aria-label="Compartida con el equipo" />
                )}
                <button
                  type="button"
                  aria-label={`Eliminar vista ${view.name}`}
                  className="ml-0.5 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-red-500 transition-opacity focus:opacity-100"
                  onClick={(e) => handleDeleteView(e, view.id)}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )
          })
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSaveDialog(true)}
          className="h-6 px-2 text-[11px] text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 gap-1"
        >
          <BookmarkPlus className="w-3 h-3" /> Guardar vista actual
        </Button>
      </div>

      {/* Badges de filtros activos */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap" aria-label="Filtros activos">
          {activeFilters.map((f, i) => (
            <Badge
              key={`${f.field}-${f.operator}-${i}`}
              variant="outline"
              className="text-[11px] font-normal bg-emerald-50/50 text-emerald-800 border-emerald-200 gap-1 py-0.5"
            >
              {describeFilter(f, entity)}
              <button
                type="button"
                aria-label={`Quitar filtro ${describeFilter(f, entity)}`}
                onClick={() => removeFilter(i)}
                className="hover:text-red-500 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          <button
            type="button"
            onClick={() => onFiltersChange([])}
            className="text-[11px] text-slate-400 hover:text-red-500 transition-colors underline underline-offset-2"
          >
            Limpiar todo
          </button>
        </div>
      )}

      {/* Dialog Guardar vista actual */}
      <Dialog open={showSaveDialog} onOpenChange={(open) => { if (!open && !saving) setShowSaveDialog(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Guardar vista actual</DialogTitle>
            <DialogDescription>
              Guarda estos filtros para acceder a ellos con un clic. {entity === 'clients' ? 'Clientes' : 'Oportunidades'}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="view-name">Nombre de la vista *</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder={entity === 'clients' ? 'Ej: Clientes calientes sin email' : 'Ej: Montos arriba de 2M'}
                autoFocus
                disabled={saving}
              />
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-500 mb-1.5">Filtros a incluir:</p>
              {filtersToSave().length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {filtersToSave().map((f, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-normal bg-white">
                      {describeFilter(f, entity)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Sin filtros (vista de todo el listado)</p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="share-view" className="cursor-pointer">Compartir con el equipo</Label>
                <p className="text-[11px] text-slate-400 mt-0.5">Los demás miembros podrán usar esta vista</p>
              </div>
              <Switch id="share-view" checked={shareWithTeam} onCheckedChange={setShareWithTeam} disabled={saving} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveView} disabled={saving || !viewName.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar vista'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
