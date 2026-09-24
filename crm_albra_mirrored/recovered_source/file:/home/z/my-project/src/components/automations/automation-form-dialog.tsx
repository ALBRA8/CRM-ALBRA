'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Automation {
  id?: string
  name?: string
  type?: string
  trigger?: string
  conditions?: string | null
  actions?: string
  message?: string | null
  isActive?: boolean
}

interface AutomationFormDialogProps {
  open: boolean
  onClose: () => void
  editAutomation?: Automation | null
}

export function AutomationFormDialog({ open, onClose, editAutomation }: AutomationFormDialogProps) {
  const [form, setForm] = useState({
    name: editAutomation?.name ?? '',
    type: editAutomation?.type ?? 'reminder',
    trigger: editAutomation?.trigger ?? 'days_inactive',
    conditions: '',
    actions: editAutomation?.actions ?? '',
    message: editAutomation?.message ?? '',
    isActive: editAutomation?.isActive ?? true,
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.type || !form.trigger) {
      toast.error('Nombre, tipo y trigger son requeridos')
      return
    }

    setLoading(true)
    try {
      const payload = {
        name: form.name,
        type: form.type,
        trigger: form.trigger,
        conditions: form.conditions ? JSON.parse(form.conditions) : null,
        actions: form.actions ? JSON.parse(form.actions) : { type: 'send_message' },
        message: form.message || null,
        isActive: form.isActive,
      }

      if (editAutomation?.id) {
        await api.updateAutomation(editAutomation.id, payload)
        toast.success('Automatización actualizada')
      } else {
        await api.createAutomation(payload)
        toast.success('Automatización creada')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar automatización')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editAutomation?.id ? 'Editar Automatización' : 'Nueva Automatización'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Ej: Recordatorio de cita"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reminder">Recordatorio</SelectItem>
                  <SelectItem value="inactive_recovery">Recuperación</SelectItem>
                  <SelectItem value="loyalty">Fidelización</SelectItem>
                  <SelectItem value="follow_up">Seguimiento</SelectItem>
                  <SelectItem value="custom">Personalizada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Trigger</Label>
              <Select value={form.trigger} onValueChange={(v) => setForm((p) => ({ ...p, trigger: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="days_inactive">Días sin contacto</SelectItem>
                  <SelectItem value="before_appointment">Antes de cita</SelectItem>
                  <SelectItem value="after_service">Después del servicio</SelectItem>
                  <SelectItem value="stage_change">Cambio de etapa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Condiciones (JSON)</Label>
            <Textarea
              value={form.conditions}
              onChange={(e) => setForm((p) => ({ ...p, conditions: e.target.value }))}
              placeholder='Ej: {"daysInactive": 30, "minTemperature": "Tibio"}'
              rows={2}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label>Acciones (JSON)</Label>
            <Textarea
              value={form.actions}
              onChange={(e) => setForm((p) => ({ ...p, actions: e.target.value }))}
              placeholder='Ej: {"type": "send_message", "channel": "whatsapp"}'
              rows={2}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label>Template de Mensaje</Label>
            <Textarea
              value={form.message}
              onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
              placeholder="Hola {nombre}, te recordamos tu cita el {fecha}..."
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={form.isActive}
              onCheckedChange={(checked) => setForm((p) => ({ ...p, isActive: checked }))}
            />
            <Label>Activar automatización</Label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : editAutomation?.id ? 'Actualizar' : 'Crear'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
