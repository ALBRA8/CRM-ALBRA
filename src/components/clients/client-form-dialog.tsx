'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Client {
  id?: string
  name?: string
  email?: string | null
  phone?: string
  company?: string | null
  identifier?: string | null
  address?: string | null
  city?: string | null
  source?: string
  temperature?: string
  tags?: string | null
  notes?: string | null
}

interface CustomFieldDef {
  id: string
  name: string
  fieldType: string
  entity: string
  options?: string | null
  isRequired: boolean
  order: number
  isActive: boolean
}

interface CustomFieldValue {
  id: string
  fieldId: string
  entityId: string
  value?: string | null
  field?: CustomFieldDef
}

interface ClientFormDialogProps {
  open: boolean
  onClose: () => void
  editClient?: Client | null
}

export function ClientFormDialog({ open, onClose, editClient }: ClientFormDialogProps) {
  const [form, setForm] = useState({
    name: editClient?.name ?? '',
    email: editClient?.email ?? '',
    phone: editClient?.phone ?? '',
    identifier: editClient?.identifier ?? '',
    company: editClient?.company ?? '',
    address: editClient?.address ?? '',
    city: editClient?.city ?? '',
    source: editClient?.source ?? 'manual',
    temperature: editClient?.temperature ?? 'Frio',
    tags: editClient?.tags ?? '',
    notes: editClient?.notes ?? '',
  })
  const [loading, setLoading] = useState(false)

  // Custom fields state
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [cfLoading, setCfLoading] = useState(false)

  // Reset form when dialog opens or editClient changes
  useState(() => {
    setForm({
      name: editClient?.name ?? '',
      email: editClient?.email ?? '',
      phone: editClient?.phone ?? '',
      identifier: editClient?.identifier ?? '',
      company: editClient?.company ?? '',
      address: editClient?.address ?? '',
      city: editClient?.city ?? '',
      source: editClient?.source ?? 'manual',
      temperature: editClient?.temperature ?? 'Frio',
      tags: editClient?.tags ?? '',
      notes: editClient?.notes ?? '',
    })
  })

  // Load custom fields when dialog opens
  useEffect(() => {
    if (open) {
      loadCustomFields()
      if (editClient?.id) {
        loadCustomFieldValues(editClient.id)
      } else {
        setCustomValues({})
      }
    }
  }, [open, editClient?.id])

  // Also reset form when editClient changes
  useEffect(() => {
    setForm({
      name: editClient?.name ?? '',
      email: editClient?.email ?? '',
      phone: editClient?.phone ?? '',
      identifier: editClient?.identifier ?? '',
      company: editClient?.company ?? '',
      address: editClient?.address ?? '',
      city: editClient?.city ?? '',
      source: editClient?.source ?? 'manual',
      temperature: editClient?.temperature ?? 'Frio',
      tags: editClient?.tags ?? '',
      notes: editClient?.notes ?? '',
    })
  }, [editClient])

  const loadCustomFields = async () => {
    try {
      setCfLoading(true)
      const data = await api.getCustomFields('client')
      setCustomFields((data.fields as CustomFieldDef[]) || [])
    } catch {
      // Custom fields may not be configured
    } finally {
      setCfLoading(false)
    }
  }

  const loadCustomFieldValues = async (entityId: string) => {
    try {
      const data = await api.getCustomFieldValues(entityId)
      const vals = (data.values as CustomFieldValue[]) || []
      const mapped: Record<string, string> = {}
      for (const v of vals) {
        mapped[v.fieldId] = v.value || ''
      }
      setCustomValues(mapped)
    } catch {
      // Values may not exist yet
    }
  }

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const updateCustomValue = (fieldId: string, value: string) => {
    setCustomValues((prev) => ({ ...prev, [fieldId]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.phone) {
      toast.error('Nombre y teléfono son requeridos')
      return
    }

    setLoading(true)
    try {
      let clientId = editClient?.id

      if (clientId) {
        await api.updateClient(clientId, {
          name: form.name,
          email: form.email || null,
          phone: form.phone,
          identifier: form.identifier || null,
          company: form.company || null,
          address: form.address || null,
          city: form.city || null,
          source: form.source,
          temperature: form.temperature,
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()) : null,
          notes: form.notes || null,
        })
        toast.success('Cliente actualizado exitosamente')
      } else {
        const result = await api.createClient({
          name: form.name,
          email: form.email || null,
          phone: form.phone,
          identifier: form.identifier || null,
          company: form.company || null,
          address: form.address || null,
          city: form.city || null,
          source: form.source,
          temperature: form.temperature,
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()) : null,
          notes: form.notes || null,
        }) as { client?: { id: string } }
        clientId = result?.client?.id
        toast.success('Cliente creado exitosamente')
      }

      // Save custom field values
      if (clientId && customFields.length > 0) {
        const fields = customFields.map(cf => ({
          fieldId: cf.id,
          value: customValues[cf.id] ?? null,
        })).filter(f => f.value !== null && f.value !== '')

        if (fields.length > 0) {
          try {
            await api.saveCustomFieldValues({ entityId: clientId, fields })
          } catch {
            // Custom field save failure is non-critical
            console.error('Failed to save custom field values')
          }
        }
      }

      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar cliente')
    } finally {
      setLoading(false)
    }
  }

  const renderCustomField = (cf: CustomFieldDef) => {
    const value = customValues[cf.id] || ''

    switch (cf.fieldType) {
      case 'text':
        return (
          <Input
            value={value}
            onChange={(e) => updateCustomValue(cf.id, e.target.value)}
            placeholder={cf.name}
          />
        )
      case 'number':
        return (
          <Input
            type="number"
            value={value}
            onChange={(e) => updateCustomValue(cf.id, e.target.value)}
            placeholder={cf.name}
          />
        )
      case 'date':
        return (
          <Input
            type="date"
            value={value}
            onChange={(e) => updateCustomValue(cf.id, e.target.value)}
          />
        )
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={value === 'true'}
              onCheckedChange={(checked) => updateCustomValue(cf.id, checked ? 'true' : 'false')}
            />
            <Label className="text-sm text-slate-600">{value === 'true' ? 'Sí' : 'No'}</Label>
          </div>
        )
      case 'select':
        const options = cf.options ? JSON.parse(cf.options) as string[] : []
        return (
          <Select value={value} onValueChange={(v) => updateCustomValue(cf.id, v)}>
            <SelectTrigger>
              <SelectValue placeholder={`Seleccionar ${cf.name.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt, i) => (
                <SelectItem key={i} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      default:
        return (
          <Input
            value={value}
            onChange={(e) => updateCustomValue(cf.id, e.target.value)}
            placeholder={cf.name}
          />
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editClient?.id ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Nombre completo"
                required
              />
            </div>
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label>Teléfono *</Label>
              <Input
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="+52 123 456 7890"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="correo@ejemplo.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Identificador</Label>
              <Input
                value={form.identifier}
                onChange={(e) => updateField('identifier', e.target.value)}
                placeholder="Cédula / ID"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Input
                value={form.company}
                onChange={(e) => updateField('company', e.target.value)}
                placeholder="Nombre de empresa"
              />
            </div>
            <div className="space-y-2">
              <Label>Ciudad</Label>
              <Input
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="Ciudad"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Dirección</Label>
            <Input
              value={form.address}
              onChange={(e) => updateField('address', e.target.value)}
              placeholder="Dirección completa"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fuente</Label>
              <Select value={form.source} onValueChange={(v) => updateField('source', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="web">Web</SelectItem>
                  <SelectItem value="referral">Referido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Temperatura</Label>
              <Select value={form.temperature} onValueChange={(v) => updateField('temperature', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Frio">Frío</SelectItem>
                  <SelectItem value="Tibio">Tibio</SelectItem>
                  <SelectItem value="Caliente">Caliente</SelectItem>
                  <SelectItem value="Fuego">Fuego</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags (separados por coma)</Label>
            <Input
              value={form.tags}
              onChange={(e) => updateField('tags', e.target.value)}
              placeholder="VIP, frecuente, empresarial"
            />
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Notas adicionales sobre el cliente..."
              rows={3}
            />
          </div>

          {/* Custom Fields Section */}
          {customFields.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-slate-700">Campos Personalizados</Label>
                {cfLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> Cargando campos...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {customFields.map((cf) => (
                      <div key={cf.id} className="space-y-1.5">
                        <Label className="text-xs text-slate-500">
                          {cf.name}
                          {cf.isRequired && <span className="text-red-500 ml-0.5">*</span>}
                        </Label>
                        {renderCustomField(cf)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : editClient?.id ? (
                'Actualizar'
              ) : (
                'Crear Cliente'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
