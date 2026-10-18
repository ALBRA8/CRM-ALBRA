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
import { format } from 'date-fns'

interface ReservationFormDialogProps {
  open: boolean
  onClose: () => void
  defaultDate?: Date
}

export function ReservationFormDialog({ open, onClose, defaultDate }: ReservationFormDialogProps) {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [form, setForm] = useState({
    clientId: '',
    title: '',
    serviceType: '',
    date: defaultDate ? format(defaultDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
    time: '10:00',
    duration: '60',
    location: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      loadClients()
      if (defaultDate) {
        setForm((p) => ({ ...p, date: format(defaultDate, 'yyyy-MM-dd') }))
      }
    }
  }, [open, defaultDate])

  const loadClients = async () => {
    try {
      const data = await api.getClients({ limit: '100' })
      setClients((data.clients as Array<{ id: string; name: string }>) ?? [])
    } catch {
      // silently fail
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.date) {
      toast.error('Título y fecha son requeridos')
      return
    }

    setLoading(true)
    try {
      const dateTime = new Date(`${form.date}T${form.time}:00`)
      await api.createReservation({
        clientId: form.clientId || null,
        title: form.title,
        serviceType: form.serviceType || null,
        date: dateTime.toISOString(),
        duration: parseInt(form.duration) || 60,
        location: form.location || null,
        notes: form.notes || null,
      })
      toast.success('Reserva creada exitosamente')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear reserva')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Reserva</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <Select value={form.clientId} onValueChange={(v) => setForm((p) => ({ ...p, clientId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar cliente (opcional)" />
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
              placeholder="Ej: Consulta inicial"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de Servicio</Label>
            <Select value={form.serviceType} onValueChange={(v) => setForm((p) => ({ ...p, serviceType: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consulta">Consulta</SelectItem>
                <SelectItem value="seguimiento">Seguimiento</SelectItem>
                <SelectItem value="evaluacion">Evaluación</SelectItem>
                <SelectItem value="presencial">Presencial</SelectItem>
                <SelectItem value="virtual">Virtual</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Fecha *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Input
                type="time"
                value={form.time}
                onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Duración (min)</Label>
              <Input
                type="number"
                value={form.duration}
                onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Ubicación</Label>
            <Input
              value={form.location}
              onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
              placeholder="Ej: Oficina central / Zoom / Google Meet"
            />
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Notas adicionales..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creando...</> : 'Crear Reserva'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
