'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Eye, MessageCircle, Send, Mail, Smartphone } from 'lucide-react'
import { toast } from 'sonner'

interface Template {
  id: string
  name: string
  channel: string
  subject?: string | null
  content: string
  variables?: string | null
  category?: string | null
  isActive: boolean
  createdAt: string
}

const channelIcons: Record<string, React.ReactNode> = {
  whatsapp: <MessageCircle className="w-3 h-3" />,
  telegram: <Send className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
  sms: <Smartphone className="w-3 h-3" />,
}

const channelColors: Record<string, string> = {
  whatsapp: 'bg-emerald-100 text-emerald-700',
  telegram: 'bg-sky-100 text-sky-700',
  email: 'bg-amber-100 text-amber-700',
  sms: 'bg-purple-100 text-purple-700',
}

const categoryLabels: Record<string, string> = {
  follow_up: 'Seguimiento',
  confirmation: 'Confirmación',
  promotion: 'Promoción',
  reminder: 'Recordatorio',
}

export function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTemplate, setEditTemplate] = useState<Template | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [channel, setChannel] = useState('whatsapp')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [variables, setVariables] = useState('')
  const [category, setCategory] = useState('follow_up')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadTemplates() }, [])

  const loadTemplates = async () => {
    try {
      setLoading(true)
      const data = await api.getTemplates()
      setTemplates((data.templates as Template[]) || [])
    } catch {
      toast.error('Error al cargar plantillas')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setName('')
    setChannel('whatsapp')
    setSubject('')
    setContent('')
    setVariables('')
    setCategory('follow_up')
    setEditTemplate(null)
  }

  const handleEdit = (t: Template) => {
    setEditTemplate(t)
    setName(t.name)
    setChannel(t.channel)
    setSubject(t.subject || '')
    setContent(t.content)
    setVariables(t.variables ? JSON.parse(t.variables).join(', ') : '')
    setCategory(t.category || 'follow_up')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error('Nombre y contenido son requeridos')
      return
    }
    setSaving(true)
    try {
      const vars = variables.split(',').map(v => v.trim()).filter(Boolean)
      const payload = {
        name,
        channel,
        subject: subject || null,
        content,
        variables: vars.length > 0 ? vars : null,
        category,
      }

      if (editTemplate) {
        await api.updateTemplate(editTemplate.id, payload)
        toast.success('Plantilla actualizada')
      } else {
        await api.createTemplate(payload)
        toast.success('Plantilla creada')
      }
      setShowForm(false)
      resetForm()
      loadTemplates()
    } catch {
      toast.error('Error al guardar plantilla')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteTemplate(id)
      toast.success('Plantilla eliminada')
      loadTemplates()
    } catch {
      toast.error('Error al eliminar plantilla')
    }
  }

  const renderPreview = (template: Template) => {
    let rendered = template.content
    const sampleData: Record<string, string> = {
      nombre: 'Juan Pérez',
      fecha: new Date().toLocaleDateString('es'),
      servicio: 'Consultoría',
      empresa: 'ACME Corp',
      hora: '10:00 AM',
      telefono: '+52 123 456 7890',
      email: 'juan@ejemplo.com',
    }
    // Replace {{variable}} with sample data
    rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, varName) => sampleData[varName] || match)
    return rendered
  }

  if (loading) {
    return <div className="py-8 text-center text-slate-400 text-sm">Cargando plantillas...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{templates.length} plantillas configuradas</p>
        <Button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Nueva Plantilla
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="py-12 text-center">
          <Mail className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No hay plantillas. Crea tu primera plantilla de mensaje.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {templates.map(t => (
            <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${channelColors[t.channel] || 'bg-slate-100 text-slate-600'}`}>
                {channelIcons[t.channel] || <Mail className="w-3 h-3" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900 truncate">{t.name}</p>
                  <Badge variant="outline" className="text-[10px]">{t.channel}</Badge>
                  {t.category && <Badge variant="outline" className="text-[10px]">{categoryLabels[t.category] || t.category}</Badge>}
                </div>
                <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{t.content}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewTemplate(t)}>
                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(t)}>
                  <Pencil className="w-3.5 h-3.5 text-slate-400" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(t.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Template Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetForm() } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTemplate ? 'Editar Plantilla' : 'Nueva Plantilla'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Seguimiento inicial" />
              </div>
              <div className="space-y-2">
                <Label>Canal</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="telegram">Telegram</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="follow_up">Seguimiento</SelectItem>
                    <SelectItem value="confirmation">Confirmación</SelectItem>
                    <SelectItem value="promotion">Promoción</SelectItem>
                    <SelectItem value="reminder">Recordatorio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {channel === 'email' && (
                <div className="space-y-2">
                  <Label>Asunto (email)</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto del correo" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Contenido</Label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} placeholder="Hola {{nombre}}, tu cita está confirmada para el {{fecha}}..." />
              <p className="text-xs text-slate-400">Usa {'{{variable}}'} para insertar variables dinámicas</p>
            </div>
            <div className="space-y-2">
              <Label>Variables (separadas por coma)</Label>
              <Input value={variables} onChange={(e) => setVariables(e.target.value)} placeholder="nombre, fecha, servicio, empresa" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setShowForm(false); resetForm() }} disabled={saving}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? 'Guardando...' : editTemplate ? 'Actualizar' : 'Crear Plantilla'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vista Previa: {previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className={channelColors[previewTemplate?.channel || 'whatsapp']}>
                {previewTemplate?.channel}
              </Badge>
              {previewTemplate?.category && (
                <Badge variant="outline">{categoryLabels[previewTemplate.category] || previewTemplate.category}</Badge>
              )}
            </div>
            {previewTemplate?.subject && (
              <div>
                <Label className="text-xs text-slate-400">Asunto</Label>
                <p className="text-sm">{previewTemplate.subject}</p>
              </div>
            )}
            <div>
              <Label className="text-xs text-slate-400">Contenido renderizado</Label>
              <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm whitespace-pre-wrap">
                {previewTemplate ? renderPreview(previewTemplate) : ''}
              </div>
            </div>
            {previewTemplate?.variables && (
              <div>
                <Label className="text-xs text-slate-400">Variables</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {JSON.parse(previewTemplate.variables).map((v: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs">{'{{' + v + '}}'}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
