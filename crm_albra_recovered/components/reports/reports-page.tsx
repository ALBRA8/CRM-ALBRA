'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  TrendingUp,
  Users,
  Clock,
  Target,
  Download,
  Calendar,
  DollarSign,
  BarChart3,
  ArrowRight,
  Percent,
  FileText,
  FileSpreadsheet,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'

interface PipelineStage {
  name: string
  count: number
  value: number
  color: string
}

interface RevenueMonth {
  month: string
  revenue: number
  expenses: number
}

interface TopClient {
  id: string
  name: string
  totalValue: number
  opportunityCount: number
}

interface SourceData {
  source: string
  count: number
  value: number
}

interface ConversionRates {
  leads: number
  qualified: number
  proposed: number
  closed: number
  leadToQualified: number
  qualifiedToProposed: number
  proposedToClosed: number
  overallRate: number
}

interface ReportData {
  pipelineStages: PipelineStage[]
  revenueByMonth: RevenueMonth[]
  salesBySource: SourceData[]
  topClients: TopClient[]
  conversionRates: ConversionRates
  averageDealDays: number
  summary: {
    totalRevenue: number
    totalExpenses: number
    newClients: number
    newOpportunities: number
    wonOpportunities: number
    totalOpps: number
  }
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  web: 'Web',
  referral: 'Referido',
}

const SOURCE_COLORS: Record<string, string> = {
  manual: '#6b7280',
  whatsapp: '#059669',
  telegram: '#0ea5e9',
  web: '#8b5cf6',
  referral: '#f59e0b',
}

const PIE_COLORS = ['#059669', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#6b7280']

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v)

const periods = [
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: '90d', label: '90 días' },
  { value: '1y', label: '1 año' },
  { value: 'all', label: 'Todo' },
]

export function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30d')

  const loadReport = useCallback(async () => {
    try {
      setLoading(true)
      const result = await api.getReports(period)
      setData(result as ReportData)
    } catch {
      toast.error('Error al cargar reporte')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  const handleExportCSV = () => {
    if (!data) return
    const lines = ['Métrica,Valor']
    lines.push(`Ingresos Totales,${data.summary.totalRevenue}`)
    lines.push(`Egresos Totales,${data.summary.totalExpenses}`)
    lines.push(`Clientes Nuevos,${data.summary.newClients}`)
    lines.push(`Oportunidades Nuevas,${data.summary.newOpportunities}`)
    lines.push(`Oportunidades Ganadas,${data.summary.wonOpportunities}`)
    lines.push(`Tasa de Conversión General,${data.conversionRates.overallRate}%`)
    lines.push(`Duración Promedio (días),${data.averageDealDays}`)
    lines.push('')
    lines.push('Etapa,Cantidad,Valor')
    data.pipelineStages.forEach(s => lines.push(`${s.name},${s.count},${s.value}`))
    lines.push('')
    lines.push('Mes,Ingresos,Egresos')
    data.revenueByMonth.forEach(r => lines.push(`${r.month},${r.revenue},${r.expenses}`))
    lines.push('')
    lines.push('Fuente,Cantidad,Valor')
    data.salesBySource.forEach(s => lines.push(`${SOURCE_LABELS[s.source] || s.source},${s.count},${s.value}`))
    lines.push('')
    lines.push('Métrica de Conversión,Valor')
    lines.push(`Leads a Calificados,${data.conversionRates.leadToQualified}%`)
    lines.push(`Calificados a Propuesta,${data.conversionRates.qualifiedToProposed}%`)
    lines.push(`Propuesta a Cierre,${data.conversionRates.proposedToClosed}%`)

    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_${period}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Reporte CSV exportado')
  }

  const handleExportPDF = async () => {
    try {
      await api.downloadReportPdf(period)
      toast.success('Reporte PDF descargado')
    } catch {
      toast.error('Error al generar PDF')
    }
  }

  const handleExportExcel = async () => {
    try {
      await api.downloadReportExcel(period)
      toast.success('Reporte Excel descargado')
    } catch {
      toast.error('Error al generar Excel')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Reportes</h1>
            <p className="text-sm text-slate-500 mt-1">Análisis de tu negocio</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Reportes</h1>
            <p className="text-sm text-slate-500">Análisis detallado de tu negocio</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period Selector */}
          {periods.map(p => (
            <Button
              key={p.value}
              variant={period === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p.value)}
              className={period === p.value ? 'bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs' : 'h-8 text-xs'}
            >
              {p.label}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-8 text-xs gap-1.5">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExportPDF()} className="h-8 text-xs gap-1.5">
            <FileText className="w-3.5 h-3.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExportExcel()} className="h-8 text-xs gap-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { title: 'Ingresos', value: formatCurrency(data.summary.totalRevenue), icon: DollarSign, color: 'bg-emerald-50 text-emerald-600' },
          { title: 'Egresos', value: formatCurrency(data.summary.totalExpenses), icon: TrendingUp, color: 'bg-red-50 text-red-600' },
          { title: 'Clientes Nuevos', value: data.summary.newClients.toString(), icon: Users, color: 'bg-teal-50 text-teal-600' },
          { title: 'Tasa Conversión', value: `${data.conversionRates.overallRate}%`, icon: Target, color: 'bg-purple-50 text-purple-600' },
          { title: 'Duración Prom.', value: `${data.averageDealDays} días`, icon: Clock, color: 'bg-amber-50 text-amber-600' },
        ].map((kpi, i) => (
          <motion.div key={kpi.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.06 }}>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className={`w-9 h-9 rounded-lg ${kpi.color} flex items-center justify-center mb-2`}>
                  <kpi.icon className="w-4 h-4" />
                </div>
                <p className="text-xl font-bold text-slate-900">{kpi.value}</p>
                <p className="text-xs text-slate-500">{kpi.title}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Funnel */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.24 }}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-600" /> Embudo del Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.pipelineStages.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.pipelineStages} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#475569' }} width={100} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === 'count') return [value, 'Oportunidades']
                        return [formatCurrency(value), 'Valor']
                      }}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {data.pipelineStages.map((entry, index) => (
                        <Cell key={index} fill={entry.color || PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
                  No hay datos del pipeline
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Revenue Trend with Expenses */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.3 }}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" /> Ingresos vs Egresos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.revenueByMonth.length > 0 && data.revenueByMonth.some(r => r.revenue > 0 || r.expenses > 0) ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.revenueByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        const label = name === 'revenue' ? 'Ingresos' : 'Egresos'
                        return [formatCurrency(value), label]
                      }}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Legend formatter={(value: string) => value === 'revenue' ? 'Ingresos' : 'Egresos'} />
                    <Line type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={2.5} dot={{ r: 4, fill: '#059669', strokeWidth: 2, stroke: '#fff' }} />
                    <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4, fill: '#ef4444', strokeWidth: 2, stroke: '#fff' }} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
                  No hay datos financieros
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Middle Row: Conversion Rates */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.36 }}>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Percent className="w-5 h-5 text-emerald-600" /> Tasas de Conversión
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Leads → Calificados */}
              <div className="text-center p-4 bg-slate-50 rounded-xl">
                <div className="flex items-center justify-center gap-1 mb-2">
                  <span className="text-xs font-medium text-slate-500">Leads</span>
                  <ArrowRight className="w-3 h-3 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">Calificados</span>
                </div>
                <p className="text-2xl font-bold text-emerald-600">{data.conversionRates.leadToQualified}%</p>
                <p className="text-[11px] text-slate-400 mt-1">{data.conversionRates.leads} → {data.conversionRates.qualified}</p>
              </div>
              {/* Calificados → Propuesta */}
              <div className="text-center p-4 bg-slate-50 rounded-xl">
                <div className="flex items-center justify-center gap-1 mb-2">
                  <span className="text-xs font-medium text-slate-500">Calificados</span>
                  <ArrowRight className="w-3 h-3 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">Propuesta</span>
                </div>
                <p className="text-2xl font-bold text-teal-600">{data.conversionRates.qualifiedToProposed}%</p>
                <p className="text-[11px] text-slate-400 mt-1">{data.conversionRates.qualified} → {data.conversionRates.proposed}</p>
              </div>
              {/* Propuesta → Cierre */}
              <div className="text-center p-4 bg-slate-50 rounded-xl">
                <div className="flex items-center justify-center gap-1 mb-2">
                  <span className="text-xs font-medium text-slate-500">Propuesta</span>
                  <ArrowRight className="w-3 h-3 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">Cierre</span>
                </div>
                <p className="text-2xl font-bold text-purple-600">{data.conversionRates.proposedToClosed}%</p>
                <p className="text-[11px] text-slate-400 mt-1">{data.conversionRates.proposed} → {data.conversionRates.closed}</p>
              </div>
              {/* General */}
              <div className="text-center p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <div className="flex items-center justify-center gap-1 mb-2">
                  <span className="text-xs font-medium text-emerald-600">Conversión General</span>
                </div>
                <p className="text-2xl font-bold text-emerald-600">{data.conversionRates.overallRate}%</p>
                <p className="text-[11px] text-emerald-400 mt-1">Pipeline → Cierre Ganado</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales by Source Pie */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.42 }}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-600" /> Clientes por Fuente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.salesBySource.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.salesBySource}
                      dataKey="count"
                      nameKey="source"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ source, count }: { source: string; count: number }) => `${SOURCE_LABELS[source] || source}: ${count}`}
                    >
                      {data.salesBySource.map((entry, index) => (
                        <Cell key={index} fill={SOURCE_COLORS[entry.source] || PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [value, 'Clientes']} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">
                  No hay datos por fuente
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Top Clients */}
        <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.48 }}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-600" /> Top Clientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.topClients.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {data.topClients.map((client, i) => (
                    <div key={client.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{client.name}</p>
                          <Badge variant="outline" className="text-[10px] h-4">{client.opportunityCount} op.</Badge>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-slate-900">{formatCurrency(client.totalValue)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-400 text-sm">No hay datos de clientes</div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
