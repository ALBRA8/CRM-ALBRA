'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, FileText, Printer, Download, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'

interface QuoteItem {
  id: string
  sku?: string | null
  description: string
  quantity: number
  unitPrice: number
  subtotal: number
}

interface QuoteDetailData {
  id: string
  quoteNumber: string
  status: string
  subtotal: number
  discount: number
  tax: number
  total: number
  notes?: string | null
  validUntil?: string | null
  createdAt: string
  client: { id: string; name: string; email?: string; phone?: string; company?: string; address?: string }
  opportunity?: { id: string; title: string } | null
  items: QuoteItem[]
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
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v)

export function QuoteDetail() {
  const { selectedQuoteId, setView } = useAppStore()
  const [quote, setQuote] = useState<QuoteDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  useEffect(() => {
    if (selectedQuoteId) loadQuote()
  }, [selectedQuoteId])

  const loadQuote = async () => {
    if (!selectedQuoteId) return
    try {
      const data = await api.getQuote(selectedQuoteId)
      setQuote(data.quote as QuoteDetailData)
    } catch {
      toast.error('Error al cargar cotización')
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!quote) return
    try {
      await api.updateQuoteStatus(quote.id, { status: newStatus })
      toast.success('Estado actualizado')
      loadQuote()
    } catch {
      toast.error('Error al actualizar estado')
    }
  }

  const handleDownloadPdf = async () => {
    if (!quote) return
    setDownloadingPdf(true)
    try {
      const token = localStorage.getItem('crm_token')
      const res = await fetch(`/api/quotes/pdf?id=${quote.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Error al generar PDF')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${quote.quoteNumber}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('PDF descargado')
    } catch {
      toast.error('Error al generar PDF')
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Cotización no encontrada</p>
        <Button onClick={() => setView('quotes')} className="mt-4">Volver</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setView('quotes')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{quote.quoteNumber}</h1>
              <Badge className={`text-xs ${statusColors[quote.status] ?? ''}`}>
                {statusLabels[quote.status] ?? quote.status}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {quote.client.name} · {format(new Date(quote.createdAt), "d 'de' MMMM, yyyy", { locale: es })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={quote.status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Borrador</SelectItem>
              <SelectItem value="sent">Enviada</SelectItem>
              <SelectItem value="accepted">Aceptada</SelectItem>
              <SelectItem value="rejected">Rechazada</SelectItem>
              <SelectItem value="expired">Expirada</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleDownloadPdf} disabled={downloadingPdf}>
            {downloadingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} PDF
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-2" /> Imprimir
          </Button>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          {/* Client Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-2">DE</h3>
              <p className="text-sm font-medium text-slate-900">CRM ALBRA</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-500 mb-2">PARA</h3>
              <p className="text-sm font-medium text-slate-900">{quote.client.name}</p>
              {quote.client.company && <p className="text-xs text-slate-500">{quote.client.company}</p>}
              {quote.client.email && <p className="text-xs text-slate-500">{quote.client.email}</p>}
              {quote.client.address && <p className="text-xs text-slate-500">{quote.client.address}</p>}
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase pb-3">SKU</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase pb-3">Descripción</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-3">Cant.</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-3">Precio Unit.</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-3">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50">
                    <td className="py-3 text-sm text-slate-500">{item.sku ?? '—'}</td>
                    <td className="py-3 text-sm text-slate-900">{item.description}</td>
                    <td className="py-3 text-sm text-slate-600 text-right">{item.quantity}</td>
                    <td className="py-3 text-sm text-slate-600 text-right">{formatCurrency(item.unitPrice)}</td>
                    <td className="py-3 text-sm font-medium text-slate-900 text-right">{formatCurrency(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end mt-6">
            <div className="w-72 space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span>{formatCurrency(quote.subtotal)}</span>
              </div>
              {quote.discount > 0 && (
                <div className="flex justify-between text-sm text-red-600">
                  <span>Descuento</span>
                  <span>-{formatCurrency(quote.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-slate-600">
                <span>IVA (16%)</span>
                <span>{formatCurrency(quote.tax)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-200">
                <span>Total</span>
                <span>{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </div>

          {quote.notes && (
            <div className="mt-6 pt-4 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 mb-1">NOTAS</h4>
              <p className="text-sm text-slate-600">{quote.notes}</p>
            </div>
          )}

          {quote.validUntil && (
            <p className="text-xs text-slate-400 mt-4">
              Válida hasta: {format(new Date(quote.validUntil), "d 'de' MMMM, yyyy", { locale: es })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
