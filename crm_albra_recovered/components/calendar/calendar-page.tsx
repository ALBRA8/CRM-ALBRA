'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ReservationFormDialog } from './reservation-form-dialog'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  User,
  XCircle,
  CalendarDays,
  CircleDot,
  CheckCircle2,
} from 'lucide-react'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  getDate,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'

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

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const statusConfig: Record<string, { bg: string; text: string; label: string; dot: string; border: string }> = {
  confirmed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Confirmada', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-600', label: 'Cancelada', dot: 'bg-red-400', border: 'border-red-200' },
  completed: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Completada', dot: 'bg-slate-400', border: 'border-slate-200' },
  no_show: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'No asistió', dot: 'bg-amber-400', border: 'border-amber-200' },
}

export function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const loadReservations = useCallback(async () => {
    try {
      const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
      const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd')
      const data = await api.getReservations({
        startDate: start,
        endDate: end,
        limit: '100',
      })
      setReservations(data.reservations as Reservation[])
    } catch {
      toast.error('Error al cargar reservas')
    } finally {
      setLoading(false)
    }
  }, [currentMonth])

  useEffect(() => {
    loadReservations()
  }, [loadReservations])

  const selectedDayReservations = selectedDate
    ? reservations.filter((r) => isSameDay(new Date(r.date), selectedDate))
    : []

  const getReservationsForDay = (day: Date) =>
    reservations.filter((r) => isSameDay(new Date(r.date), day))

  // Generate all days for the calendar grid
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const allDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  const goToPrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1))
  const goToNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1))
  const goToToday = () => {
    setCurrentMonth(new Date())
    setSelectedDate(new Date())
  }

  // Count reservations by status
  const confirmedCount = reservations.filter(r => r.status === 'confirmed').length
  const completedCount = reservations.filter(r => r.status === 'completed').length

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] gap-3">
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendario</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gestiona tus reservas y citas</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick Stats */}
          <div className="hidden sm:flex items-center gap-3 mr-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              {confirmedCount} confirmadas
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              {completedCount} completadas
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={goToToday}
            className="text-xs h-8 gap-1.5"
          >
            <CircleDot className="w-3.5 h-3.5" />
            Hoy
          </Button>
          <Button
            onClick={() => setShowForm(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva Reserva
          </Button>
        </div>
      </div>

      {/* Main Calendar Layout - fills all available space */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 min-h-0">
        {/* Calendar Grid Card - fills the container */}
        <Card className="border-0 shadow-sm flex flex-col min-h-0 overflow-hidden">
          <CardContent className="flex-1 flex flex-col p-0 min-h-0">
            {/* Month Navigation */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goToPrevMonth}
                  className="h-7 w-7 text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={goToNextMonth}
                  className="h-7 w-7 text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight capitalize">
                {format(currentMonth, 'MMMM yyyy', { locale: es })}
              </h2>
              <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 border-slate-200 text-slate-500">
                {reservations.length} reservas
              </Badge>
            </div>

            {/* Calendar Grid - fills remaining space */}
            <div className="flex-1 flex flex-col p-2 min-h-0">
              {/* Weekday Headers */}
              <div className="grid grid-cols-7 gap-0.5 mb-0.5 flex-shrink-0">
                {WEEKDAY_LABELS.map((day) => (
                  <div
                    key={day}
                    className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest py-1.5"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Day Cells - fill all remaining height */}
              <div className="flex-1 grid grid-cols-7 auto-rows-fr gap-0.5 min-h-0">
                {allDays.map((day, idx) => {
                  const dayReservations = getReservationsForDay(day)
                  const hasReservations = dayReservations.length > 0
                  const isCurrentMonth = isSameMonth(day, currentMonth)
                  const isSelected = isSameDay(day, selectedDate)
                  const isTodayDate = isToday(day)

                  return (
                    <motion.button
                      key={idx}
                      onClick={() => setSelectedDate(day)}
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.985 }}
                      className={`
                        relative flex flex-col items-center justify-start pt-2 rounded-lg transition-all duration-150 overflow-hidden
                        ${!isCurrentMonth ? 'opacity-25' : ''}
                        ${isSelected
                          ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 ring-2 ring-emerald-400/30'
                          : isTodayDate
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300'
                            : hasReservations
                              ? 'bg-emerald-50/50 text-slate-900 hover:bg-emerald-100/60'
                              : 'text-slate-600 hover:bg-slate-50'
                        }
                      `}
                    >
                      <span className={`
                        text-xs font-bold leading-none
                        ${isSelected ? 'text-white' : isTodayDate ? 'text-emerald-700' : ''}
                      `}>
                        {getDate(day)}
                      </span>

                      {/* Reservation indicators */}
                      {hasReservations && !isSelected && (
                        <div className="flex flex-col items-center gap-0.5 mt-1.5 px-0.5 w-full">
                          {dayReservations.slice(0, 2).map((res, i) => {
                            const sc = statusConfig[res.status] ?? statusConfig.confirmed
                            return (
                              <div
                                key={i}
                                className={`w-full h-1 rounded-full ${sc.dot} opacity-60`}
                              />
                            )
                          })}
                          {dayReservations.length > 2 && (
                            <span className="text-[8px] text-slate-400 leading-none">+{dayReservations.length - 2}</span>
                          )}
                        </div>
                      )}

                      {/* Selected day: white dots */}
                      {hasReservations && isSelected && (
                        <div className="flex items-center gap-0.5 mt-1">
                          {dayReservations.slice(0, 3).map((_, i) => (
                            <div key={i} className="w-1 h-1 rounded-full bg-white/60" />
                          ))}
                        </div>
                      )}
                    </motion.button>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Panel - Selected Day Detail */}
        <div className="flex flex-col gap-3 min-h-0">
          {/* Selected Day Header */}
          <Card className="border-0 shadow-sm flex-shrink-0">
            <CardContent className="p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                    {selectedDate ? format(selectedDate, 'EEEE', { locale: es }) : ''}
                  </p>
                  <h3 className="text-lg font-bold text-slate-900 capitalize mt-0.5 leading-tight">
                    {selectedDate
                      ? format(selectedDate, "d 'de' MMMM", { locale: es })
                      : 'Selecciona un día'}
                  </h3>
                </div>
                {selectedDate && (
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <CalendarDays className="w-5 h-5 text-emerald-600" />
                  </div>
                )}
              </div>

              {selectedDayReservations.length > 0 && (
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100">
                  <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px] h-5">
                    {selectedDayReservations.length} {selectedDayReservations.length === 1 ? 'reserva' : 'reservas'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] text-emerald-600 hover:text-emerald-700 gap-0.5 px-1.5"
                    onClick={() => setShowForm(true)}
                  >
                    <Plus className="w-2.5 h-2.5" /> Agregar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reservations List for Selected Day */}
          <Card className="border-0 shadow-sm flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardContent className="flex-1 overflow-y-auto p-2.5">
              {loading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : selectedDayReservations.length > 0 ? (
                <AnimatePresence mode="popLayout">
                  <div className="space-y-1.5">
                    {selectedDayReservations
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map((res, idx) => (
                        <motion.div
                          key={res.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.15, delay: idx * 0.04 }}
                        >
                          <ReservationMiniCard
                            reservation={res}
                            onUpdate={loadReservations}
                          />
                        </motion.div>
                      ))}
                  </div>
                </AnimatePresence>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center mb-2">
                    <CalendarDays className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-xs font-medium text-slate-400">Sin reservas</p>
                  <p className="text-[10px] text-slate-300 mt-0.5">Este día no tiene citas</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 text-[10px] h-6 gap-1 border-dashed"
                    onClick={() => setShowForm(true)}
                  >
                    <Plus className="w-2.5 h-2.5" /> Agendar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reservation Form */}
      <ReservationFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); loadReservations() }}
        defaultDate={selectedDate}
      />
    </div>
  )
}

/* ──── Compact reservation card for the side panel ──── */
function ReservationMiniCard({ reservation, onUpdate }: { reservation: Reservation; onUpdate: () => void }) {
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
      toast.success('Reserva completada')
      onUpdate()
    } catch {
      toast.error('Error al actualizar reserva')
    }
  }

  const st = statusConfig[reservation.status] ?? statusConfig.confirmed

  return (
    <div className={`rounded-lg p-2.5 ${st.bg} border ${st.border} hover:shadow-sm transition-all duration-150`}>
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${st.dot}`} />
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-slate-900 truncate leading-tight">{reservation.title}</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {format(new Date(reservation.date), 'HH:mm', { locale: es })} · {reservation.duration}min
              </span>
            </div>
          </div>
        </div>
        <Badge className={`text-[8px] h-4 px-1 border-0 ${st.bg} ${st.text} font-medium`}>
          {st.label}
        </Badge>
      </div>

      {/* Extra details */}
      {(reservation.client || reservation.location) && (
        <div className="flex flex-wrap gap-x-2.5 gap-y-0 mt-1.5 ml-3">
          {reservation.client && (
            <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
              <User className="w-2.5 h-2.5" />
              {reservation.client.name}
            </span>
          )}
          {reservation.location && (
            <span className="text-[10px] text-slate-500 flex items-center gap-0.5 truncate">
              <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{reservation.location}</span>
            </span>
          )}
        </div>
      )}

      {/* Actions for confirmed */}
      {reservation.status === 'confirmed' && (
        <div className="flex gap-3 mt-1.5 ml-3 pt-1.5 border-t border-black/5">
          <button
            onClick={handleMarkComplete}
            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 transition-colors flex items-center gap-0.5"
          >
            <CheckCircle2 className="w-2.5 h-2.5" /> Completar
          </button>
          <button
            onClick={handleCancel}
            className="text-[10px] font-semibold text-red-400 hover:text-red-600 transition-colors flex items-center gap-0.5"
          >
            <XCircle className="w-2.5 h-2.5" /> Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
