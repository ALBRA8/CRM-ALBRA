'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QuoteFormDialog } from './quote-form-dialog'
import { QuoteDetail } from './quote-detail'
import { Plus, FileText, Search, Download, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

interface Quote {
  id: string
  quoteNumber: string
  status: string
  subtotal: number
  discount: number
  tax: number
  total: number
  createdAt: string
  client: { id: string; name: string; email?: string; phone?: string }
  opportunity?: { id: string; title: string } | null
  _count?: { items: number }
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-100 text-sky-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
}

const statusLabels: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Expirada',
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v)

export function QuotesList() {
  const { setView, setSelectedQuoteId } = useAppStore()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadQuotes = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '50' }
      if (statusFilter !== 'all') params.status = statusFilter
      const data = await api.getQuotes(params)
      setQuotes(data.quotes as Quote[])
    } catch {
      toast.error('Error al cargar cotizaciones')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadQuotes()
  }, [loadQuotes])

  const handleDelete = async () => {
    if (!quoteToDelete) return
    setDeleting(true)
    try {
      await api.deleteQuote(quoteToDelete.id)
      toast.success(`Cotización ${quoteToDelete.quoteNumber} eliminada`)
      setQuoteToDelete(null)
      loadQuotes()
    } catch {
      toast.error('Error al eliminar cotización')
    } finally {
      setDeleting(false)
    }
  }

  const filteredQuotes = quotes.filter((q) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      q.quoteNumber.toLowerCase().includes(s) ||
      q.client.name.toLowerCase().includes(s)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cotizaciones</h1>
          <p className="text-sm text-slate-500 mt-1">Gestiona tus propuestas comerciales</p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="w-4 h-4 mr-2" /> Nueva Cotización
        </Button>
        <Button
          variant="outline"
          onClick={() => window.open('/api/export/csv?type=quotes', '_blank')}
          className="gap-1.5"
        >
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar por número o cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="draft">Borrador</SelectItem>
              <SelectItem value="sent">Enviada</SelectItem>
              <SelectItem value="accepted">Aceptada</SelectItem>
              <SelectItem value="rejected">Rechazada</SelectItem>
              <SelectItem value="expired">Expirada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Quotes Table */}
      <Card className="border-0 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-600">No hay cotizaciones</h3>
            <p className="text-sm text-slate-400 mt-1">Crea tu primera cotización</p>
            <Button
              onClick={() => setShowForm(true)}
              className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" /> Crear Cotización
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Número</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Cliente</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Total</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Estado</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Fecha</th>
                  <th className="w-12 px-4 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedQuoteId(quote.id)
                      setView('quote-detail')
                    }}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{quote.quoteNumber}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{quote.client.name}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900 hidden sm:table-cell">{formatCurrency(quote.total)}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs ${statusColors[quote.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {statusLabels[quote.status] ?? quote.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 hidden md:table-cell">
                      {format(new Date(quote.createdAt), "d MMM yyyy", { locale: es })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title="Eliminar cotización"
                        onClick={(e) => {
                          e.stopPropagation()
                          setQuoteToDelete(quote)
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Quote Form */}
      <QuoteFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); loadQuotes() }}
      />

      {/* Confirm delete */}
      <AlertDialog open={!!quoteToDelete} onOpenChange={(open) => !open && setQuoteToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cotización {quoteToDelete?.quoteNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará la cotización de {quoteToDelete?.client?.name} por {quoteToDelete ? formatCurrency(quoteToDelete.total) : ''} junto con todos sus items. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete() }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
