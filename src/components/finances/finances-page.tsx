'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TransactionFormDialog } from './transaction-form-dialog'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Download,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { formatCurrency as formatCurrencyActive, subscribeCurrency } from '@/lib/currency'

interface Transaction {
  id: string
  type: string
  amount: number
  currency?: string | null
  category?: string | null
  description: string
  referenceId?: string | null
  date: string
  createdAt: string
}

const categoryLabels: Record<string, string> = {
  venta: 'Venta',
  servicio: 'Servicio',
  compra_inventario: 'Compra Inventario',
  operacion: 'Operación',
  marketing: 'Marketing',
  nomina: 'Nómina',
  otro: 'Otro',
}

export function FinancesPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [totalIngresos, setTotalIngresos] = useState(0)
  const [totalEgresos, setTotalEgresos] = useState(0)
  // Moneda: usa el selector global del negocio (Configuración → Negocio,
  // lib/currency) — auditoría Antigravity #6: antes estaba fija en MXN.
  const [, setCurrencyTick] = useState(0)

  useEffect(() => subscribeCurrency(() => setCurrencyTick((t) => t + 1)), [])

  const formatCurrency = (v: number) => formatCurrencyActive(v)

  const loadTransactions = useCallback(async () => {
    try {
      const [ingresosData, egresosData] = await Promise.all([
        api.getTransactions({ type: 'ingreso', limit: '100' }),
        api.getTransactions({ type: 'egreso', limit: '100' }),
      ])
      const ingresos = ingresosData.transactions as Transaction[]
      const egresos = egresosData.transactions as Transaction[]
      setTotalIngresos(ingresosData.totals.sum as number)
      setTotalEgresos(egresosData.totals.sum as number)
      const all = [...ingresos, ...egresos]
      setTransactions(all.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ))
    } catch {
      toast.error('Error al cargar transacciones')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  // Monthly chart data
  const chartData = (() => {
    const months: Record<string, { month: string; ingresos: number; egresos: number }> = {}
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = format(d, 'yyyy-MM')
      months[key] = { month: format(d, 'MMM yy', { locale: es }), ingresos: 0, egresos: 0 }
    }
    transactions.forEach((t) => {
      const key = format(new Date(t.date), 'yyyy-MM')
      if (months[key]) {
        if (t.type === 'ingreso') months[key].ingresos += t.amount
        else months[key].egresos += t.amount
      }
    })
    return Object.values(months)
  })()

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  const balance = totalIngresos - totalEgresos

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Finanzas</h1>
          <p className="text-sm text-slate-500 mt-1">Resumen de ingresos y egresos</p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="w-4 h-4 mr-2" /> Nueva Transacción
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            // Descarga con token en el header (window.open no envía JWT → 401)
            try {
              await api.downloadTransactionsCsv()
              toast.success('CSV de transacciones descargado')
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Error al exportar CSV')
            }
          }}
          className="gap-1.5"
        >
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-slate-900 mt-3">{formatCurrency(totalIngresos)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Total Ingresos</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                <TrendingDown className="w-5 h-5" />
              </div>
              <ArrowDownRight className="w-4 h-4 text-red-500" />
            </div>
            <p className="text-2xl font-bold text-slate-900 mt-3">{formatCurrency(totalEgresos)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Total Egresos</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                <DollarSign className="w-5 h-5" />
              </div>
              <span className={`text-xs font-medium ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {balance >= 0 ? 'Positivo' : 'Negativo'}
              </span>
            </div>
            <p className={`text-2xl font-bold mt-3 ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(balance)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">Balance</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Ingresos vs Egresos</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.some((d) => d.ingresos > 0 || d.egresos > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatCurrency(value),
                    name === 'ingresos' ? 'Ingresos' : 'Egresos',
                  ]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Legend
                  formatter={(value) => (value === 'ingresos' ? 'Ingresos' : 'Egresos')}
                />
                <Bar dataKey="ingresos" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
              Los datos financieros aparecerán aquí
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Transacciones Recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${t.type === 'ingreso' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                      {t.type === 'ingreso' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-400">{format(new Date(t.date), "d MMM yyyy", { locale: es })}</span>
                        {t.category && (
                          <Badge variant="outline" className="text-[10px]">
                            {categoryLabels[t.category] ?? t.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className={`text-sm font-semibold ${t.type === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {t.type === 'ingreso' ? '+' : '-'}{formatCurrency(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm">
              No hay transacciones registradas
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction Form */}
      <TransactionFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); loadTransactions() }}
      />
    </div>
  )
}
