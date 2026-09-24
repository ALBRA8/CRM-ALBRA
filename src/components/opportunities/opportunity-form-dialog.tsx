'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface OpportunityFormDialogProps {
  open: boolean
  onClose: () => void
}

export function OpportunityFormDialog({ open, onClose }: OpportunityFormDialogProps) {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [stages, setStages] = useState<Array<{ id: string; name: string; order: number }>>([])
  const [form, setForm] = useState({
    clientId: '',
    title: '',
    interest: '',
    estimatedValue: '',
    probability: '50',
    stageId: '',
    notes: '',
    nextAction: '',
    nextActionDate: '',
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) loadOptions()
  }, [open])

  const loadOptions = async () => {
    try {
      const [clientsData, pipelineData] = await Promise.all([
        api.getClients({ limit: '100' }),
        api.getPipeline(),
      ])
      setClients((clientsData.clients as Array<{ id: string; name: string }>) ?? [])
      const pipelineStages = (pipelineData as { stages: Array<{ id: string; name: string; order: number }> }).stages
      setStages(pipelineStages)
      if (pipelineStages.length > 0 && !form.stageId) {
        setForm((prev) => ({ ...prev, stageId: pipelineStages[0].id }))
      }
    } catch {
      // silently fail
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.clientId || !form.title) {
      toast.error('Cliente y título son requeridos')
      return
    }

    setLoading(true)
    try {
      await api.createOpportunity({
        clientId: form.clientId,
        title: form.title,
        interest: form.interest || undefined,
        estimatedValue: parseFloat(form.estimatedValue) || 0,
        probability: parseInt(form.probability) || 20,
        stageId: form.stageId || undefined,
        notes: form.notes || undefined,
        nextAction: form.nextAction || undefined,
        nextActionDate: form.nextActionDate || undefined,
      })
      toast.success('Oportunidad creada exitosamente')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear oportunidad')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Oportunidad</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente *</Label>
            <Select value={form.clientId} onValueChange={(v) => setForm((p) => ({ ...p, clientId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Título *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Ej: Venta de servicio premium"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Interés</Label>
              <Input
                value={form.interest}
                onChange={(e) => setForm((p) => ({ ...p, interest: e.target.value }))}
                placeholder="¿Qué le interesa?"
              />
            </div>
            <div className="space-y-2">
              <Label>Etapa</Label>
              <Select value={form.stageId} onValueChange={(v) => setForm((p) => ({ ...p, stageId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Valor Estimado</Label>
              <Input
                type="number"
                value={form.estimatedValue}
                onChange={(e) => setForm((p) => ({ ...p, estimatedValue: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>Probabilidad (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.probability}
                onChange={(e) => setForm((p) => ({ ...p, probability: e.target.value }))}
                placeholder="50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Próxima Acción</Label>
              <Input
                value={form.nextAction}
                onChange={(e) => setForm((p) => ({ ...p, nextAction: e.target.value }))}
                placeholder="Ej: Llamar para seguimiento"
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha de Acción</Label>
              <Input
                type="date"
                value={form.nextActionDate}
                onChange={(e) => setForm((p) => ({ ...p, nextActionDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Notas sobre la oportunidad..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creando...</> : 'Crear Oportunidad'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
