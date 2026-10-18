'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Clock,
  Search,
  Filter,
  User,
  Users,
  TrendingUp,
  FileText,
  Calendar,
  DollarSign,
  Settings,
  MessageSquare,
  Zap,
  Package,
  RefreshCw,
  Download,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { format, isToday, isYesterday, isThisWeek, isThisMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'

interface ActivityEntry {
  id: string
  userId: string
  action: string
  entity: string
  entityId: string
  description: string
  metadata?: string | null
  createdAt: string
  user?: { name: string; email: string }
}

const entityIcons: Record<string, typeof User> = {
  client: Users,
  opportunity: TrendingUp,
  quote: FileText,
  reservation: Calendar,
  transaction: DollarSign,
  automation: Zap,
  service: Package,
  settings: Settings,
  chat: MessageSquare,
}

const entityColors: Record<string, string> = {
  client: 'bg-blue-100 text-blue-600',
  opportunity: 'bg-emerald-100 text-emerald-600',
  quote: 'bg-violet-100 text-violet-600',
  reservation: 'bg-amber-100 text-amber-600',
  transaction: 'bg-green-100 text-green-600',
  automation: 'bg-purple-100 text-purple-600',
  service: 'bg-orange-100 text-orange-600',
  settings: 'bg-slate-100 text-slate-600',
  chat: 'bg-pink-100 text-pink-600',
}

const actionColors: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  delete: 'bg-red-50 text-red-700 border-red-200',
  send: 'bg-sky-50 text-sky-700 border-sky-200',
  login: 'bg-slate-50 text-slate-700 border-slate-200',
  status_change: 'bg-amber-50 text-amber-700 border-amber-200',
}

export function ActivityPage() {
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 50

  useEffect(() => {
    loadActivity()
  }, [entityFilter, actionFilter, page])

  const loadActivity = async () => {
    try {
      setLoading(true)
      const params: Record<string, string> = {
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      }
      if (entityFilter !== 'all') params.entity = entityFilter
      if (actionFilter !== 'all') params.action = actionFilter
      const data = await api.getActivityLog(params) as { activities: ActivityEntry[]; total: number }
      setActivities(data.activities || [])
      setTotal(data.total || 0)
    } catch {
      toast.error('Error al cargar registro de actividad')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    const csvRows = [
      ['Fecha', 'Usuario', 'Acción', 'Entidad', 'Descripción'].join(','),
      ...activities.map(a => [
        new Date(a.createdAt).toLocaleString('es'),
        a.user?.name ?? 'Sistema',
        a.action,
        a.entity,
        `"${a.description.replace(/"/g, '""')}"`,
      ].join(','))
    ]
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `actividad_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Archivo CSV descargado')
  }

  const filtered = activities.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return a.description.toLowerCase().includes(q) || (a.user?.name ?? '').toLowerCase().includes(q) || a.entity.toLowerCase().includes(q)
  })

  const groupedActivities = (() => {
    const groups: Record<string, ActivityEntry[]> = {}
    filtered.forEach(a => {
      const d = new Date(a.createdAt)
      let key: string
      if (isToday(d)) key = 'Hoy'
      else if (isYesterday(d)) key = 'Ayer'
      else if (isThisWeek(d)) key = format(d, "EEEE", { locale: es })
      else if (isThisMonth(d)) key = format(d, "d 'de' MMMM", { locale: es })
      else key = format(d, "d 'de' MMMM, yyyy", { locale: es })
      if (!groups[key]) groups[key] = []
      groups[key].push(a)
    })
    return groups
  })()

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Registro de Actividad</h1>
          <p className="text-sm text-slate-500 mt-1">
            {total} registros · Historial completo de acciones
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadActivity} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar en actividades..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1) }}>
              <SelectTrigger className="w-44 h-9">
                <Filter className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                <SelectValue placeholder="Entidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las entidades</SelectItem>
                <SelectItem value="client">Clientes</SelectItem>
                <SelectItem value="opportunity">Oportunidades</SelectItem>
                <SelectItem value="quote">Cotizaciones</SelectItem>
                <SelectItem value="reservation">Reservas</SelectItem>
                <SelectItem value="transaction">Transacciones</SelectItem>
                <SelectItem value="automation">Automatizaciones</SelectItem>
                <SelectItem value="service">Servicios</SelectItem>
                <SelectItem value="chat">Chat</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1) }}>
              <SelectTrigger className="w-40 h-9">
                <SelectValue placeholder="Acción" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las acciones</SelectItem>
                <SelectItem value="create">Creación</SelectItem>
                <SelectItem value="update">Actualización</SelectItem>
                <SelectItem value="delete">Eliminación</SelectItem>
                <SelectItem value="send">Envío</SelectItem>
                <SelectItem value="status_change">Cambio de estado</SelectItem>
                <SelectItem value="login">Inicio de sesión</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Activity Timeline */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-start gap-3 p-3">
              <Skeleton className="w-9 h-9 rounded-lg flex-shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-4 w-64 mb-2" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 text-center">
            <Clock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-1">Sin Actividad</h3>
            <p className="text-sm text-slate-500">No se encontraron registros con los filtros seleccionados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedActivities).map(([group, entries]) => (
            <div key={group}>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{group}</h3>
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-xs text-slate-400">{entries.length} acciones</span>
              </div>
              <div className="space-y-2">
                {entries.map((entry, idx) => {
                  const Icon = entityIcons[entry.entity] ?? Clock
                  const color = entityColors[entry.entity] ?? 'bg-slate-100 text-slate-600'
                  const actionColor = actionColors[entry.action] ?? 'bg-slate-50 text-slate-700 border-slate-200'
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.02 }}
                    >
                      <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                        <CardContent className="p-3 flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm text-slate-900">{entry.description}</span>
                              <Badge variant="outline" className={`text-[10px] h-5 ${actionColor}`}>
                                {entry.action}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-400">
                                {entry.user?.name ?? 'Sistema'}
                              </span>
                              <span className="text-xs text-slate-300">·</span>
                              <span className="text-xs text-slate-400">
                                {format(new Date(entry.createdAt), 'HH:mm', { locale: es })}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span className="text-sm text-slate-500">
                Página {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Siguiente
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
