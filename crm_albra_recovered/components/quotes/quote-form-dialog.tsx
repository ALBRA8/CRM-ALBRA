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
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface QuoteFormDialogProps {
  open: boolean
  onClose: () => void
}

interface QuoteItemForm {
  sku: string
  description: string
  quantity: string
  unitPrice: string
}

export function QuoteFormDialog({ open, onClose }: QuoteFormDialogProps) {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [opportunities, setOpportunities] = useState<Array<{ id: string; title: string }>>([])
  const [form, setForm] = useState({
    clientId: '',
    opportunityId: '',
    discount: '0',
    notes: '',
    validUntil: '',
  })
  const [items, setItems] = useState<QuoteItemForm[]>([
    { sku: '', description: '', quantity: '1', unitPrice: '0' },
  ])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) loadOptions()
  }, [open])

  useEffect(() => {
    if (form.clientId) loadOpportunities()
  }, [form.clientId])

  const loadOptions = async () => {
    try {
      const data = await api.getClients({ limit: '100' })
      setClients((data.clients as Array<{ id: string; name: string }>) ?? [])
    } catch {
      // silently fail
    }
  }

  const loadOpportunities = async () => {
    try {
      const data = await api.getOpportunities({ clientId: form.clientId, limit: '20' })
      setOpportunities(
        ((data.opportunities as Array<{ id: string; title: string }>) ?? [])
      )
    } catch {
      // silently fail
    }
  }

  const addItem = () => {
    setItems([...items, { sku: '', description: '', quantity: '1', unitPrice: '0' }])
  }

  const removeItem = (index: number) => {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof QuoteItemForm, value: string) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const getSubtotal = () =>
    items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0), 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.clientId) {
      toast.error('Selecciona un cliente')
      return
    }
    if (items.some((item) => !item.description)) {
      toast.error('Todos los items deben tener descripción')
      return
    }

    setLoading(true)
    try {
      await api.createQuote({
        clientId: form.clientId,
        opportunityId: form.opportunityId || null,
        items: items.map((item) => ({
          sku: item.sku || null,
          description: item.description,
          quantity: parseInt(item.quantity) || 1,
          unitPrice: parseFloat(item.unitPrice) || 0,
        })),
        discount: parseFloat(form.discount) || 0,
        notes: form.notes || null,
        validUntil: form.validUntil || null,
      })
      toast.success('Cotización creada exitosamente')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear cotización')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva Cotización</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={form.clientId} onValueChange={(v) => setForm((p) => ({ ...p, clientId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Oportunidad</Label>
              <Select value={form.opportunityId} onValueChange={(v) => setForm((p) => ({ ...p, opportunityId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguna</SelectItem>
                  {opportunities.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="w-4 h-4 mr-1" /> Agregar Item
              </Button>
            </div>
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-2">
                  {index === 0 && <Label className="text-xs text-slate-500">SKU</Label>}
                  <Input
                    value={item.sku}
                    onChange={(e) => updateItem(index, 'sku', e.target.value)}
                    placeholder="SKU"
                    className="text-sm"
                  />
                </div>
                <div className="col-span-4">
                  {index === 0 && <Label className="text-xs text-slate-500">Descripción *</Label>}
                  <Input
                    value={item.description}
                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                    placeholder="Descripción del producto/servicio"
                    className="text-sm"
                    required
                  />
                </div>
                <div className="col-span-2">
                  {index === 0 && <Label className="text-xs text-slate-500">Cant.</Label>}
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="col-span-3">
                  {index === 0 && <Label className="text-xs text-slate-500">Precio Unit.</Label>}
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    disabled={items.length <= 1}
                    className="text-red-400 hover:text-red-600 h-9 w-9"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="bg-slate-50 p-4 rounded-lg space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal</span>
              <span>${getSubtotal().toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-slate-600 whitespace-nowrap">Descuento (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.discount}
                onChange={(e) => setForm((p) => ({ ...p, discount: e.target.value }))}
                className="w-20 text-sm"
              />
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>IVA (16%)</span>
              <span>${(getSubtotal() * (1 - (parseFloat(form.discount) || 0) / 100) * 0.16).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total</span>
              <span>${(getSubtotal() * (1 - (parseFloat(form.discount) || 0) / 100) * 1.16).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Válida hasta</Label>
              <Input
                type="date"
                value={form.validUntil}
                onChange={(e) => setForm((p) => ({ ...p, validUntil: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Notas o condiciones adicionales..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creando...</> : 'Crear Cotización'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
