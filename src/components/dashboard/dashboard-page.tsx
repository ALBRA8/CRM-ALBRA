'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Users,
  TrendingUp,
  DollarSign,
  Target,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Sparkles,
  ChevronRight,
  Phone,
  ArrowRight,
  Activity,
  FilePlus,
  ArrowRightLeft,
  Edit3,
  Trash2,
  StickyNote,
  Badge as BadgeIcon,
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { motion } from 'framer-motion'
import { toast } from 'sonner'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PipelineStage {
  id: string
  name: string
  order: number
  color: string
  count: number
  value: number
}

interface Reservation {
  id: string
  title: string
  date: string
  duration: number
  client?: { id: string; name: string }
}

interface ActivityItem {
  id: string
  role: string
  content: string
  createdAt: string
  client?: { id: string; name: string }
}

interface Suggestion {
  client: {
    id: string
    name: string
    phone?: string | null
    email?: string | null
    temperature: string
    score: number
    daysSinceContact: number
    latestOpportunity?: {
      id: string
      title: string
      stage: string
      estimatedValue: number
    } | null
    upcomingReservation?: {
      id: string
      title: string
      date: string
    } | null
  }
  priorityScore: number
  reasons: string[]
}

interface DashboardData {
  totalClients: number
  opportunitiesByStage: PipelineStage[]
  pipelineValue: number
  monthlyRevenue: number
  upcomingReservations: Reservation[]
  clientsNeedingFollowUp: Array<{
    id: string
    title: string
    nextAction?: string
    nextActionDate?: string
    client: { id: string; name: string; temperature: string }
    stage: { name: string }
  }>
  inactiveClients: number
  recentActivity: ActivityItem[]
  monthlyTrend: Array<{ month: string; revenue: number }>
  conversionRate: number
}

interface SuggestionsData {
  suggestions: Suggestion[]
  totalClients: number
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value)

const stageColorMap: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  Prospección: { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700', dot: 'bg-slate-400' },
  Calificación: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', dot: 'bg-blue-500' },
  Oferta: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', dot: 'bg-amber-500' },
  Seguimiento: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', dot: 'bg-orange-500' },
  'Cierre Ganado': { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'Cierre Perdido': { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', dot: 'bg-red-500' },
}

const defaultStageStyle = { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700', dot: 'bg-slate-400' }

const tempColors: Record<string, string> = {
  Frio: 'bg-slate-100 text-slate-600',
  Tibio: 'bg-amber-100 text-amber-700',
  Caliente: 'bg-orange-100 text-orange-700',
  Fuego: 'bg-red-100 text-red-700',
}

/* ------------------------------------------------------------------ */
/*  Skeleton Loaders                                                   */
/* ------------------------------------------------------------------ */

function KPISkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i} className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <Skeleton className="w-16 h-4 rounded" />
            </div>
            <Skeleton className="w-24 h-7 rounded mt-3" />
            <Skeleton className="w-20 h-3 rounded mt-1" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function PipelineSkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <Skeleton className="w-40 h-6 rounded" />
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="w-[170px] h-24 rounded-xl flex-shrink-0" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Audit Trail Section                                                */
/* ------------------------------------------------------------------ */

interface AuditLogEntry {
  id: string
  action: string
  entity: string
  entityId?: string | null
  description: string
  metadata?: string | null
  createdAt: string
}

const auditActionIcons: Record<string, React.ReactNode> = {
  created: <FilePlus className="w-3 h-3" />,
  updated: <Edit3 className="w-3 h-3" />,
  deleted: <Trash2 className="w-3 h-3" />,
  stage_changed: <ArrowRightLeft className="w-3 h-3" />,
  note_added: <StickyNote className="w-3 h-3" />,
}

const auditActionColors: Record<string, string> = {
  created: 'bg-emerald-500',
  updated: 'bg-sky-500',
  deleted: 'bg-red-500',
  stage_changed: 'bg-amber-500',
  note_added: 'bg-purple-500',
}

function AuditTrailSection() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadLogs()
  }, [])

  const loadLogs = async () => {
    try {
      setLoading(true)
      const data = await api.getActivityLog({ limit: '10' })
      setLogs((data.logs as AuditLogEntry[]) || [])
    } catch {
      // May fail if no auth
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-slate-900">Registro de Actividad</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.48 }}
    >
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <BadgeIcon className="w-5 h-5 text-emerald-600" />
            Registro de Actividad
          </CardTitle>
          <p className="text-xs text-slate-400">Últimas acciones en el CRM</p>
        </CardHeader>
        <CardContent>
          {logs.length > 0 ? (
            <div className="space-y-1 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className={`w-5 h-5 rounded-full mt-0.5 flex-shrink-0 ${auditActionColors[log.action] || 'bg-slate-400'} text-white flex items-center justify-center`}>
                    {auditActionIcons[log.action] || <Activity className="w-2.5 h-2.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700 line-clamp-2">{log.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px]">{log.action}</Badge>
                      <Badge variant="outline" className="text-[10px]">{log.entity}</Badge>
                      <span className="text-xs text-slate-400">
                        {formatDistanceToNow(new Date(log.createdAt), { locale: es, addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 text-sm">
              <BadgeIcon className="w-10 h-10 mx-auto mb-2 text-slate-200" />
              No hay registro de actividad
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function DashboardPage() {
  const { setView, setSelectedClientId } = useAppStore()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    try {
      setLoading(true)
      setError(null)

      const [dashboardResult, suggestionsResult] = await Promise.allSettled([
        api.getDashboard(),
        api.getSuggestions(),
      ])

      if (dashboardResult.status === 'fulfilled') {
        setDashboardData(dashboardResult.value as DashboardData)
      } else {
        console.error('Dashboard error:', dashboardResult.reason)
        setError('Error al cargar los datos del dashboard')
      }

      if (suggestionsResult.status === 'fulfilled') {
        const sugData = suggestionsResult.value as SuggestionsData
        setSuggestions(sugData.suggestions ?? [])
      }
      // Suggestions failure is non-critical, silently ignore
    } catch {
      setError('Error de conexión al cargar el dashboard')
      toast.error('Error de conexión', {
        description: 'No se pudieron cargar los datos del dashboard',
      })
    } finally {
      setLoading(false)
    }
  }

  /* ---- Loading State ---- */
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Resumen general de tu negocio</p>
        </div>
        <KPISkeleton />
        <PipelineSkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-0 shadow-sm">
            <CardHeader><Skeleton className="w-44 h-6 rounded" /></CardHeader>
            <CardContent><Skeleton className="w-full h-64 rounded" /></CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardHeader><Skeleton className="w-36 h-6 rounded" /></CardHeader>
            <CardContent><Skeleton className="w-full h-64 rounded" /></CardContent>
          </Card>
        </div>
      </div>
    )
  }

  /* ---- Error State ---- */
  if (error || !dashboardData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Resumen general de tu negocio</p>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 text-center">
            <Activity className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">{error ?? 'No se pudieron cargar los datos'}</p>
            <Button onClick={loadDashboard} variant="outline" className="mt-4">
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const data = dashboardData

  /* ---- KPI Config ---- */
  const kpis = [
    {
      title: 'Clientes Activos',
      value: data.totalClients.toString(),
      icon: Users,
      trend: data.inactiveClients > 0 ? `-${data.inactiveClients} inactivos` : 'Todos activos',
      trendUp: data.inactiveClients === 0,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
    },
    {
      title: 'Valor Pipeline',
      value: formatCurrency(data.pipelineValue),
      icon: TrendingUp,
      trend: `${data.opportunitiesByStage.reduce((a, s) => a + s.count, 0)} oportunidades`,
      trendUp: true,
      iconBg: 'bg-teal-50',
      iconColor: 'text-teal-600',
    },
    {
      title: 'Ingresos del Mes',
      value: formatCurrency(data.monthlyRevenue),
      icon: DollarSign,
      trend: data.monthlyRevenue > 0 ? 'Este mes' : 'Sin ingresos',
      trendUp: data.monthlyRevenue > 0,
      iconBg: 'bg-green-50',
      iconColor: 'text-green-600',
    },
    {
      title: 'Tasa de Conversión',
      value: `${data.conversionRate}%`,
      icon: Target,
      trend: data.conversionRate >= 30 ? 'Sobre promedio' : 'Mejorable',
      trendUp: data.conversionRate >= 30,
      iconBg: 'bg-purple-50',
      iconColor: 'text-purple-600',
    },
  ]

  /* ---- Render ---- */
  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Resumen general de tu negocio</p>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, index) => {
          const Icon = kpi.icon
          return (
            <motion.div
              key={kpi.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.06 }}
            >
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow bg-white">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className={`w-10 h-10 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${kpi.iconColor}`} />
                    </div>
                    <div className={`flex items-center gap-1 text-xs font-medium ${kpi.trendUp ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {kpi.trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {kpi.trend}
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-2xl font-bold text-slate-900 tracking-tight">{kpi.value}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{kpi.title}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* ─── Pipeline Visual ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.24 }}
      >
        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold text-slate-900">Pipeline de Ventas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-0 overflow-x-auto pb-2">
              {data.opportunitiesByStage.map((stage, idx) => {
                const style = stageColorMap[stage.name] ?? defaultStageStyle
                return (
                  <div key={stage.id} className="flex items-center flex-shrink-0">
                    <div
                      className={`${style.bg} border ${style.border} rounded-xl p-4 min-w-[160px] hover:shadow-sm transition-shadow cursor-default`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                        <span className={`text-sm font-medium ${style.text} truncate`}>{stage.name}</span>
                      </div>
                      <p className="text-2xl font-bold text-slate-900">{stage.count}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{formatCurrency(stage.value)}</p>
                    </div>
                    {idx < data.opportunitiesByStage.length - 1 && (
                      <ArrowRight className="w-5 h-5 text-slate-300 mx-1 flex-shrink-0" />
                    )}
                  </div>
                )
              })}
              {data.opportunitiesByStage.length === 0 && (
                <div className="w-full py-8 text-center text-slate-400 text-sm">
                  No hay etapas de pipeline configuradas
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Two Column Layout ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column (wider) - Revenue Chart */}
        <motion.div
          className="lg:col-span-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <Card className="border-0 shadow-sm bg-white h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold text-slate-900">Tendencia de Ingresos</CardTitle>
              <p className="text-xs text-slate-400">Últimos 6 meses</p>
            </CardHeader>
            <CardContent>
              {data.monthlyTrend.some((t) => t.revenue > 0) ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={data.monthlyTrend}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#059669" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `$${(v / 1000000).toFixed(1)}M`}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), 'Ingresos']}
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                        fontSize: 13,
                      }}
                      labelStyle={{ color: '#475569', fontWeight: 600 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="#059669"
                      strokeWidth={2.5}
                      fill="url(#colorRevenue)"
                      dot={{ r: 4, fill: '#059669', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6, fill: '#059669', strokeWidth: 2, stroke: '#fff' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
                  <div className="text-center">
                    <TrendingUp className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                    Los datos de ingresos aparecerán aquí
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Right Column - Reservations + Suggestions */}
        <motion.div
          className="lg:col-span-2 space-y-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.36 }}
        >
          {/* Próximas Reservas */}
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-600" />
                Próximas Reservas
              </CardTitle>
              <p className="text-xs text-slate-400">Próximos 7 días</p>
            </CardHeader>
            <CardContent>
              {data.upcomingReservations.length > 0 ? (
                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                  {data.upcomingReservations.map((res) => (
                    <div
                      key={res.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                      <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">{res.title}</p>
                        <p className="text-xs text-slate-500">
                          {res.client?.name ?? 'Sin cliente'} · {format(new Date(res.date), "d MMM, HH:mm", { locale: es })}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs bg-emerald-50 text-emerald-700 border-0">
                        Confirmada
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-400 text-sm">
                  <Calendar className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                  No hay reservas próximas
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sugerencias de Contacto */}
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                Sugerencias de Contacto
              </CardTitle>
              <p className="text-xs text-slate-400">Clientes que debes contactar hoy</p>
            </CardHeader>
            <CardContent>
              {suggestions.length > 0 ? (
                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                  {suggestions.slice(0, 5).map((sug) => (
                    <div
                      key={sug.client.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                      <div className="w-8 h-8 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">
                        {sug.client.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">{sug.client.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {sug.reasons[0] ?? 'Contacto general'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50 flex-shrink-0"
                        onClick={() => {
                          setSelectedClientId(sug.client.id)
                          setView('client-detail')
                          toast.info(`Navegando a ${sug.client.name}`)
                        }}
                      >
                        <Phone className="w-3 h-3 mr-1" />
                        Contactar
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-slate-400 text-sm">
                  <Sparkles className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                  ¡Todo al día! No hay sugerencias pendientes.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ─── Recent Activity (Chat Logs) ─── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.42 }}
      >
        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold text-slate-900">Actividad Reciente</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.length > 0 ? (
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                {data.recentActivity.slice(0, 10).map((activity) => {
                  const isUser = activity.role === 'user'
                  return (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${isUser ? 'bg-emerald-500' : 'bg-teal-400'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 line-clamp-1">{activity.content}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {activity.client?.name ?? 'Sistema'} · {formatDistanceToNow(new Date(activity.createdAt), { locale: es, addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 text-sm">
                <Activity className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                No hay actividad reciente
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Audit Trail (Activity Log) ─── */}
      <AuditTrailSection />

      {/* Global style for custom scrollbar */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 9999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  )
}
