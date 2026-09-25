'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { BookOpen, Plus, Pencil, Trash2, Loader2, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'

/**
 * Base de conocimiento del Agente IA (pestaña Agente IA de Configuración).
 * Entradas de texto libre (catálogo, términos, FAQ, políticas) que se inyectan
 * en los system prompts del agente de canales y del Chat AI.
 */

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  category: string
  isActive: boolean
  updatedAt: string
}

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  catalogo: 'Catálogo',
  terminos: 'Términos',
  faq: 'FAQ',
  politicas: 'Políticas',
}

const CATEGORY_BADGE: Record<string, string> = {
  general: 'bg-slate-100 text-slate-700 border-slate-200',
  catalogo: 'bg-violet-50 text-violet-700 border-violet-200',
  terminos: 'bg-blue-50 text-blue-700 border-blue-200',
  faq: 'bg-amber-50 text-amber-700 border-amber-200',
  politicas: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const EMPTY_FORM = { id: '', title: '', content: '', category: 'general' }

export function KnowledgeCard() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = useCallback(async () => {
    try {
      const res = await api.getKnowledge()
      setEntries(res.knowledge ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error cargando conocimiento')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (entry: KnowledgeEntry) => {
    setForm({ id: entry.id, title: entry.title, content: entry.content, category: entry.category })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Título y contenido son obligatorios')
      return
    }
    setSaving(true)
    try {
      if (form.id) {
        await api.updateKnowledge(form.id, { title: form.title, content: form.content, category: form.category })
        toast.success('Conocimiento actualizado')
      } else {
        await api.createKnowledge({ title: form.title, content: form.content, category: form.category })
        toast.success('Conocimiento añadido al agente')
      }
      setDialogOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error guardando')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (entry: KnowledgeEntry) => {
    try {
      await api.updateKnowledge(entry.id, { isActive: !entry.isActive })
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error actualizando')
    }
  }

  const handleDelete = async (entry: KnowledgeEntry) => {
    try {
      await api.deleteKnowledge(entry.id)
      toast.success('Entrada eliminada')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error eliminando')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.12 }}
    >
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-50 rounded-lg flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-sky-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Base de Conocimiento</CardTitle>
                <CardDescription>
                  Catálogo, términos y respuestas que el Agente IA usa al conversar por WhatsApp, Instagram, Telegram y Chat AI
                </CardDescription>
              </div>
            </div>
            <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0">
              <Plus className="w-4 h-4 mr-1" />
              Añadir
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Cargando conocimiento...
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-sm text-slate-500 font-medium">Sin conocimiento todavía</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Añade tu catálogo de servicios, precios, términos y condiciones o preguntas frecuentes. El agente los usará para responder con precisión sin inventar información.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900">{entry.title}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CATEGORY_BADGE[entry.category] ?? CATEGORY_BADGE.general}`}>
                        {CATEGORY_LABELS[entry.category] ?? entry.category}
                      </Badge>
                      {!entry.isActive && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-50 text-slate-400 border-slate-200">
                          Inactiva
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 whitespace-pre-line">{entry.content}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Switch checked={entry.isActive} onCheckedChange={() => handleToggle(entry)} aria-label="Activar/desactivar" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600" onClick={() => openEdit(entry)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-600" onClick={() => handleDelete(entry)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.id ? 'Editar conocimiento' : 'Añadir conocimiento'}</DialogTitle>
              <DialogDescription>
                El agente usará esta información para responder con precisión a tus clientes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="knowledge-title">Título</Label>
                  <Input
                    id="knowledge-title"
                    placeholder="Ej: Catálogo de servicios y precios"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoría</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="knowledge-content">Contenido</Label>
                <Textarea
                  id="knowledge-content"
                  placeholder={'Ej:\n- Consultoría CRM: $2,500\n- Auditoría de datos: $1,200\n- Pagos por transferencia o link de pago\n- Garantía de 12 meses'}
                  className="min-h-[140px] font-normal"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                />
                <p className="text-[11px] text-slate-400">{form.content.length}/8000 caracteres</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {form.id ? 'Guardar cambios' : 'Añadir al agente'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </motion.div>
  )
}
