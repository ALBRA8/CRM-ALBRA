'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, MapPin, User, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface Reservation {
  id: string
  title: string
  description?: string | null
  serviceType?: string | null
  date: string
  duration: number
  status: string
  location?: string | null
  notes?: string | null
  client?: { id: string; name: string; phone?: string; email?: string } | null
}

interface ReservationCardProps {
  reservation: Reservation
  onUpdate: () => void
}

const statusColors: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  completed: 'bg-slate-100 text-slate-600 border-slate-200',
  no_show: 'bg-amber-100 text-amber-700 border-amber-200',
}

const statusLabels: Record<string, string> = {
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Completada',
  no_show: 'No asistió',
}

export function ReservationCard({ reservation, onUpdate }: ReservationCardProps) {
  const handleCancel = async () => {
    try {
      await api.cancelReservation(reservation.id)
      toast.success('Reserva cancelada')
      onUpdate()
    } catch {
      toast.error('Error al cancelar reserva')
    }
  }

  const handleMarkComplete = async () => {
    try {
      await api.updateReservation(reservation.id, { status: 'completed' })
      toast.success('Reserva marcada como completada')
      onUpdate()
    } catch {
      toast.error('Error al actualizar reserva')
    }
  }

  return (
    <div className="p-3 rounded-lg bg-white border border-slate-100 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-medium text-slate-900 line-clamp-1">{reservation.title}</h4>
        <Badge className={`text-[10px] border ${statusColors[reservation.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {statusLabels[reservation.status] ?? reservation.status}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="w-3.5 h-3.5" />
          <span>{format(new Date(reservation.date), "HH:mm", { locale: es })} · {reservation.duration} min</span>
        </div>
        {reservation.client && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <User className="w-3.5 h-3.5" />
            <span>{reservation.client.name}</span>
          </div>
        )}
        {reservation.location && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <MapPin className="w-3.5 h-3.5" />
            <span className="truncate">{reservation.location}</span>
          </div>
        )}
      </div>

      {reservation.status === 'confirmed' && (
        <div className="flex gap-2 mt-3 pt-2 border-t border-slate-50">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={handleMarkComplete}
          >
            Completar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 text-red-500 hover:text-red-700"
            onClick={handleCancel}
          >
            <XCircle className="w-3 h-3 mr-1" /> Cancelar
          </Button>
        </div>
      )}
    </div>
  )
}
