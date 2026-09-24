'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'

interface CustomField {
  id: string
  name: string
  fieldType: string
  entity: string
  options?: string | null
  isRequired: boolean
  order: number
  isActive: boolean
}

export function CustomFieldsTab() {
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editField, setEditField] = useState<CustomField | null>(null)

  // Form
  const [name, setName] = useState('')
  const [fieldType, setFieldType] = useState('text')
  const [entity, setEntity] = useState('client')
  const [options, setOptions] = useState('')
  const [isRequired, setIsRequired] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadFields() }, [])

  const loadFields = async () => {
    try {
      setLoading(true)
      const data = await api.getCustomFields('client')
      setFields((data.fields as CustomField[]) || [])
    } catch {
      toast.error('Error al cargar campos')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setName('')
    setFieldType('text')
    setEntity('client')
    setOptions('')
    setIsRequired(false)
    setEditField(null)
  }

  const handleEdit = (f: CustomField) => {
    setEditField(f)
    setName(f.name)
    setFieldType(f.fieldType)
    setEntity(f.entity)
    setOptions(f.options ? JSON.parse(f.options).join(', ') : '')
    setIsRequired(f.isRequired)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Nombre es requerido')
      return
    }
    setSaving(true)
    try {
      const opts = fieldType === 'select' && options.trim()
        ? options.split(',').map(o => o.trim()).filter(Boolean)
        : null

      const payload = { name, fieldType, entity, options: opts, isRequired, order: fields.length }
      if (editField) {
        await api.updateCustomField(editField.id, payload)
        toast.success('Campo actualizado')
      } else {
        await api.createCustomField(payload)
        toast.success('Campo creado')
      }
      setShowForm(false)
      resetForm()
      loadFields()
    } catch {
      toast.error('Error al guardar campo')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCustomField(id)
      toast.success('Campo eliminado')
      loadFields()
    } catch {
      toast.error('Error al eliminar campo')
    }
  }

  const fieldTypeLabels: Record<string, string> = {
    text: 'Texto',
    number: 'Número',
    date: 'Fecha',
    select: 'Selección',
    boolean: 'Sí/No',
  }

  const fieldTypeColors: Record<string, string> = {
    text: 'bg-emerald-100 text-emerald-700',
    number: 'bg-sky-100 text-sky-700',
    date: 'bg-amber-100 text-amber-700',
    select: 'bg-purple-100 text-purple-700',
    boolean: 'bg-teal-100 text-teal-700',
  }

  if (loading) {
    return <div className="py-8 text-center text-slate-400 text-sm">Cargando campos...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{fields.length} campos personalizados</p>
        <Button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Nuevo Campo
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-400">No hay campos personalizados. Agrega campos adicionales a tus clientes.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {fields.map(f => (
            <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
              <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">{f.name}</p>
                  <Badge className={`text-[10px] ${fieldTypeColors[f.fieldType] || 'bg-slate-100 text-slate-600'}`}>
                    {fieldTypeLabels[f.fieldType] || f.fieldType}
                  </Badge>
                  {f.isRequired && <Badge variant="outline" className="text-[10px] text-red-600">Requerido</Badge>}
                  {!f.isActive && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
                </div>
                {f.fieldType === 'select' && f.options && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {JSON.parse(f.options).map((opt: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{opt}</Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(f)}>
                  <Pencil className="w-3.5 h-3.5 text-slate-400" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(f.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Field Form Dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">{editField ? 'Editar Campo' : 'Nuevo Campo'}</h3>
            <div className="space-y-2">
              <Label>Nombre del Campo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: RFC, Fecha de nacimiento" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={fieldType} onValueChange={setFieldType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Texto</SelectItem>
                    <SelectItem value="number">Número</SelectItem>
                    <SelectItem value="date">Fecha</SelectItem>
                    <SelectItem value="select">Selección</SelectItem>
                    <SelectItem value="boolean">Sí/No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Entidad</Label>
                <Select value={entity} onValueChange={setEntity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Cliente</SelectItem>
                    <SelectItem value="opportunity">Oportunidad</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {fieldType === 'select' && (
              <div className="space-y-2">
                <Label>Opciones (separadas por coma)</Label>
                <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Opción 1, Opción 2, Opción 3" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={isRequired} onCheckedChange={setIsRequired} />
              <Label className="text-sm">Campo requerido</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setShowForm(false); resetForm() }} disabled={saving}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? 'Guardando...' : editField ? 'Actualizar' : 'Crear Campo'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
