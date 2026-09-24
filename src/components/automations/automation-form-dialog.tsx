'use client'

/**
 * Constructor de workflows (estilo Twenty) — Feature C, Task 2-c.
 * 3 secciones: "Cuando ocurra…" (triggerType) · "Y se cumple…" (condiciones
 * dinámicas) · "Entonces…" (acciones configurables, incl. ai_followup).
 * Guarda triggerType/triggerConfig/conditions/actions como JSON strings.
 * Compatible con automatizaciones legacy (sin triggerType → Manual).
 */

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Loader2, Plus, Trash2, Zap, Filter, Sparkles, Bell, MessageCircle, Send, Mail, TrendingUp, UserCog, Bot, CalendarClock, Hand } from 'lucide-react'
import { toast } from 'sonner'

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TriggerType =
  | 'manual'
  | 'client_created'
  | 'opportunity_stage_changed'
  | 'message_received'
  | 'reservation_created'
  | 'quote_status_changed'
  | 'schedule'

export type ActionType =
  | 'notify_admin'
  | 'send_whatsapp'
  | 'send_telegram'
  | 'send_email'
  | 'create_opportunity'
  | 'update_client_status'
  | 'ai_followup'
  | 'wait'

export interface ConditionRow {
  field: string
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'in' | 'not_empty'
  value: string
}

export interface ActionRow {
  type: ActionType
  config: {
    // notify_admin
    title?: string
    body?: string
    // send_* (plantilla o texto libre)
    templateId?: string
    text?: string
    // create_opportunity
    amount?: string
    // update_client_status
    status?: string
    // ai_followup
    instruction?: string
    [key: string]: unknown
  }
}

interface Template {
  id: string
  name: string
}

interface Automation {
  id?: string
  name?: string
  type?: string
  trigger?: string | null
  triggerType?: string | null
  triggerConfig?: string | null
  conditions?: string | null
  actions?: string
  message?: string | null
  isActive?: boolean
}

interface AutomationFormDialogProps {
  open: boolean
  onClose: () => void
  editAutomation?: Automation | null
}

// ─── Etiquetas compartidas con la lista ──────────────────────────────────────

export const triggerTypeLabels: Record<string, string> = {
  client_created: 'Nuevo cliente registrado',
  opportunity_stage_changed: 'Oportunidad cambia de etapa',
  message_received: 'Mensaje recibido',
  reservation_created: 'Reserva creada',
  quote_status_changed: 'Cotización cambia de estado',
  schedule: 'Programado (cada X minutos)',
  manual: 'Manual',
}

const actionTypeLabels: Record<ActionType, string> = {
  notify_admin: 'Notificar al administrador',
  send_whatsapp: 'Enviar WhatsApp',
  send_telegram: 'Enviar Telegram',
  send_email: 'Enviar email',
  create_opportunity: 'Crear oportunidad',
  update_client_status: 'Actualizar estado del cliente',
  ai_followup: 'Seguimiento con IA',
  wait: 'Esperar (pausa)…',
}

const actionTypeDescriptions: Record<ActionType, string> = {
  notify_admin: 'Crea una notificación interna para ti o tu equipo',
  send_whatsapp: 'Envía un mensaje de WhatsApp al cliente',
  send_telegram: 'Envía un mensaje de Telegram al cliente',
  send_email: 'Envía un email al cliente',
  create_opportunity: 'Registra una oportunidad de venta',
  update_client_status: 'Cambia el estado del cliente',
  ai_followup: 'El agente IA redacta el seguimiento y lo envía',
  wait: 'Pausa el flujo y continúa después (secuencias multi-día)',
}

const operatorOptions: Array<{ value: ConditionRow['operator']; label: string }> = [
  { value: 'equals', label: 'es igual a' },
  { value: 'contains', label: 'contiene' },
  { value: 'gt', label: 'mayor que' },
  { value: 'lt', label: 'menor que' },
  { value: 'in', label: 'está en (separado por comas)' },
  { value: 'not_empty', label: 'no está vacío' },
]

// ─── Helpers de parseo (legacy + nuevo formato) ──────────────────────────────

function parseJsonSafe(s: string | null | undefined): unknown {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function parseConditions(conditionsJson?: string | null): ConditionRow[] {
  const parsed = parseJsonSafe(conditionsJson)
  if (Array.isArray(parsed)) {
    return parsed
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        field: String(c.field ?? ''),
        operator: (['equals', 'contains', 'gt', 'lt', 'in', 'not_empty'].includes(String(c.operator))
          ? c.operator
          : 'equals') as ConditionRow['operator'],
        value: c.value == null ? '' : String(c.value),
      }))
  }
  // Legacy: objeto { clave: valor } → filtras equals
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({
      field: k,
      operator: 'equals' as const,
      value: v == null ? '' : String(v),
    }))
  }
  return []
}

function parseActions(actionsJson?: string | null, legacyMessage?: string | null): ActionRow[] {
  const parsed = parseJsonSafe(actionsJson)
  let rows: ActionRow[] = []

  if (Array.isArray(parsed)) {
    rows = parsed
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => {
        const type = String(a.type ?? 'send_whatsapp')
        // Legacy: send_message → send_whatsapp
        const mapped = (type === 'send_message' ? 'send_whatsapp' : type) as ActionType
        const cfg = a.config && typeof a.config === 'object' ? a.config as Record<string, unknown> : { ...a }
        delete (cfg as Record<string, unknown>).type
        return { type: mapped, config: cfg } as ActionRow
      })
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const type = String(obj.type ?? 'send_message')
    rows = [{ type: (type === 'send_message' ? 'send_whatsapp' : type) as ActionType, config: { ...obj } }]
  }

  // Legacy: message de texto suelto → acción de WhatsApp
  if (rows.length === 0 && legacyMessage && legacyMessage.trim()) {
    rows = [{ type: 'send_whatsapp', config: { text: legacyMessage } }]
  }
  return rows
}

function parseInterval(triggerConfigJson?: string | null): string {
  const parsed = parseJsonSafe(triggerConfigJson)
  if (parsed && typeof parsed === 'object') {
    const n = Number((parsed as Record<string, unknown>).intervalMinutes)
    if (Number.isFinite(n) && n > 0) return String(n)
  }
  return '60'
}

function newAction(type: ActionType): ActionRow {
  return { type, config: {} }
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function AutomationFormDialog({ open, onClose, editAutomation }: AutomationFormDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState('custom')
  const [isActive, setIsActive] = useState(true)
  const [triggerType, setTriggerType] = useState<TriggerType>('manual')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [conditions, setConditions] = useState<ConditionRow[]>([])
  const [actions, setActions] = useState<ActionRow[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)

  // Reset del formulario cada vez que se abre (creación o edición)
  useEffect(() => {
    if (!open) return
    setName(editAutomation?.name ?? '')
    setType(editAutomation?.type ?? 'custom')
    setIsActive(editAutomation?.isActive ?? true)
    // Legacy (sin triggerType) → Manual
    setTriggerType(((editAutomation?.triggerType as TriggerType) || 'manual'))
    setIntervalMinutes(parseInterval(editAutomation?.triggerConfig))
    const condRows = parseConditions(editAutomation?.conditions)
    setConditions(condRows.length > 0 ? condRows : [])
    const actionRows = parseActions(editAutomation?.actions, editAutomation?.message)
    setActions(actionRows.length > 0 ? actionRows : [])
  }, [open, editAutomation])

  // Plantillas para send_* (opcional)
  useEffect(() => {
    if (!open) return
    api.getTemplates()
      .then((data: { templates?: Template[] }) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]))
  }, [open])

  const updateCondition = (index: number, patch: Partial<ConditionRow>) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const removeCondition = (index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index))
  }

  const updateAction = (index: number, patch: Partial<ActionRow>) => {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  const updateActionConfig = (index: number, patch: Partial<ActionRow['config']>) => {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, config: { ...a.config, ...patch } } : a)))
  }

  const removeAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index))
  }

  const addAction = (type: ActionType) => {
    setActions((prev) => [...prev, newAction(type)])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('La automatización necesita un nombre')
      return
    }
    if (actions.length === 0) {
      toast.error('Agrega al menos una acción en la sección "Entonces…"')
      return
    }

    setLoading(true)
    try {
      const validConditions = conditions.filter((c) => c.field.trim() !== '')
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type,
        isActive,
        triggerType,
        triggerConfig: triggerType === 'schedule'
          ? JSON.stringify({ intervalMinutes: Math.max(5, parseInt(intervalMinutes, 10) || 5) })
          : null,
        conditions: JSON.stringify(validConditions),
        actions: JSON.stringify(
          actions.map((a) => ({
            type: a.type,
            config: a.type === 'create_opportunity'
              ? { title: a.config.title ?? '', amount: a.config.amount ? parseFloat(a.config.amount) : null }
              : a.type === 'wait'
                ? {
                    days: Math.max(0, parseInt(String(a.config.days ?? '0'), 10) || 0),
                    hours: Math.max(0, parseInt(String(a.config.hours ?? '0'), 10) || 0),
                    minutes: Math.max(0, parseInt(String(a.config.minutes ?? '0'), 10) || 0),
                  }
                : a.config,
          }))
        ),
      }
      // Preservar el mensaje legacy si la automatización editada lo tenía
      if (editAutomation?.id && editAutomation.message) payload.message = editAutomation.message

      if (editAutomation?.id) {
        await api.updateAutomation(editAutomation.id, payload)
        toast.success('Automatización actualizada')
      } else {
        await api.createAutomation(payload)
        toast.success('Automatización creada')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar automatización')
    } finally {
      setLoading(false)
    }
  }

  const actionIcon = (t: ActionType) => {
    const map: Record<ActionType, React.ReactNode> = {
      notify_admin: <Bell className="w-3.5 h-3.5" />,
      send_whatsapp: <MessageCircle className="w-3.5 h-3.5" />,
      send_telegram: <Send className="w-3.5 h-3.5" />,
      send_email: <Mail className="w-3.5 h-3.5" />,
      create_opportunity: <TrendingUp className="w-3.5 h-3.5" />,
      update_client_status: <UserCog className="w-3.5 h-3.5" />,
      ai_followup: <Bot className="w-3.5 h-3.5" />,
      wait: <CalendarClock className="w-3.5 h-3.5" />,
    }
    return map[t] ?? <Sparkles className="w-3.5 h-3.5" />
  }

  const isChannelAction = (t: ActionType) => t === 'send_whatsapp' || t === 'send_telegram' || t === 'send_email'

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editAutomation?.id ? 'Editar Automatización' : 'Nueva Automatización'}</DialogTitle>
          <DialogDescription>
            Construye tu workflow: qué dispara la automatización, condiciones y qué hace el sistema.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Datos base */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="auto-name">Nombre *</Label>
              <Input
                id="auto-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Seguimiento IA tras cotización"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5 sm:w-44">
              <Label htmlFor="auto-type">Categoría</Label>
              <Select value={type} onValueChange={setType} disabled={loading}>
                <SelectTrigger id="auto-type" aria-label="Categoría de la automatización">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reminder">Recordatorio</SelectItem>
                  <SelectItem value="inactive_recovery">Recuperación</SelectItem>
                  <SelectItem value="loyalty">Fidelización</SelectItem>
                  <SelectItem value="follow_up">Seguimiento</SelectItem>
                  <SelectItem value="custom">Personalizada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ─── Sección 1: Cuando ocurra… ─────────────────────────────── */}
          <Card className="p-4 border border-slate-100 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
              <Zap className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">Cuando ocurra…</h3>
            </div>
            <div className="space-y-2">
              <Select value={triggerType} onValueChange={(v) => setTriggerType(v as TriggerType)} disabled={loading}>
                <SelectTrigger aria-label="Evento que dispara la automatización">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_created">Nuevo cliente registrado</SelectItem>
                  <SelectItem value="opportunity_stage_changed">Oportunidad cambia de etapa</SelectItem>
                  <SelectItem value="message_received">Mensaje recibido</SelectItem>
                  <SelectItem value="reservation_created">Reserva creada</SelectItem>
                  <SelectItem value="quote_status_changed">Cotización cambia de estado</SelectItem>
                  <SelectItem value="schedule">Programado (cada X minutos)</SelectItem>
                  <SelectItem value="manual">
                    <span className="flex items-center gap-1.5"><Hand className="w-3.5 h-3.5" /> Manual</span>
                  </SelectItem>
                </SelectContent>
              </Select>

              {triggerType === 'schedule' && (
                <div className="flex items-center gap-2 pl-1">
                  <CalendarClock className="w-4 h-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
                  <div className="flex items-center gap-2">
                    <Label htmlFor="interval-minutes" className="text-xs text-slate-500 whitespace-nowrap">Ejecutar cada</Label>
                    <Input
                      id="interval-minutes"
                      type="number"
                      min={5}
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(e.target.value)}
                      className="h-8 w-20 text-sm"
                      disabled={loading}
                    />
                    <span className="text-xs text-slate-500">minutos (mínimo 5)</span>
                  </div>
                </div>
              )}
              {triggerType === 'manual' && (
                <p className="text-xs text-slate-400 pl-1">
                  Se ejecuta al presionar &quot;Ejecutar pendientes ahora&quot; en la lista de automatizaciones.
                </p>
              )}
            </div>
          </Card>

          {/* ─── Sección 2: Y se cumple… ───────────────────────────────── */}
          <Card className="p-4 border border-slate-100 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
                <Filter className="w-4 h-4 text-amber-600" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900">Y se cumple…</h3>
                <span className="text-[11px] text-slate-400 hidden sm:inline">(opcional — todas deben cumplirse)</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setConditions((prev) => [...prev, { field: '', operator: 'equals', value: '' }])}
                disabled={loading}
              >
                <Plus className="w-3 h-3" /> Condición
              </Button>
            </div>

            {conditions.length === 0 ? (
              <p className="text-xs text-slate-400 pl-1">Sin condiciones: la automatización corre con cada evento.</p>
            ) : (
              <div className="space-y-2">
                {conditions.map((cond, index) => (
                  <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-center bg-slate-50 rounded-lg p-2">
                    <Input
                      aria-label={`Campo de la condición ${index + 1}`}
                      placeholder="Campo (ej: estimatedValue)"
                      value={cond.field}
                      onChange={(e) => updateCondition(index, { field: e.target.value })}
                      className="h-8 text-xs"
                      disabled={loading}
                    />
                    <Select
                      value={cond.operator}
                      onValueChange={(v) => updateCondition(index, { operator: v as ConditionRow['operator'] })}
                      disabled={loading}
                    >
                      <SelectTrigger className="h-8 text-xs w-full sm:w-40" aria-label={`Operador de la condición ${index + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {operatorOptions.map((op) => (
                          <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {cond.operator !== 'not_empty' ? (
                      <Input
                        aria-label={`Valor de la condición ${index + 1}`}
                        placeholder="Valor"
                        value={cond.value}
                        onChange={(e) => updateCondition(index, { value: e.target.value })}
                        className="h-8 text-xs"
                        disabled={loading}
                      />
                    ) : (
                      <div className="h-8 hidden sm:block" aria-hidden="true" />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 justify-self-end"
                      onClick={() => removeCondition(index)}
                      aria-label={`Quitar condición ${index + 1}`}
                      disabled={loading}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ─── Sección 3: Entonces… ──────────────────────────────────── */}
          <Card className="p-4 border border-slate-100 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold flex-shrink-0">3</div>
                <Sparkles className="w-4 h-4 text-violet-600" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900">Entonces…</h3>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={loading}>
                    <Plus className="w-3 h-3" /> Acción
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {(Object.keys(actionTypeLabels) as ActionType[]).map((t) => (
                    <DropdownMenuItem key={t} onClick={() => addAction(t)} className="gap-2 cursor-pointer">
                      <span className="text-slate-400">{actionIcon(t)}</span>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{actionTypeLabels[t]}</span>
                        <span className="text-[10px] text-slate-400">{actionTypeDescriptions[t]}</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {actions.length === 0 ? (
              <p className="text-xs text-slate-400 pl-1">
                Agrega al menos una acción. Prueba <strong className="text-violet-600">Seguimiento con IA</strong>: el agente redacta el mensaje por ti.
              </p>
            ) : (
              <div className="space-y-3">
                {actions.map((action, index) => (
                  <div key={index} className="border border-slate-100 rounded-lg p-3 bg-white space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                        {actionIcon(action.type)}
                      </div>
                      <Select
                        value={action.type}
                        onValueChange={(v) => updateAction(index, { type: v as ActionType, config: {} })}
                        disabled={loading}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1" aria-label={`Tipo de acción ${index + 1}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(actionTypeLabels) as ActionType[]).map((t) => (
                            <SelectItem key={t} value={t}>{actionTypeLabels[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                        onClick={() => removeAction(index)}
                        aria-label={`Quitar acción ${index + 1}`}
                        disabled={loading}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* Config inline según tipo */}
                    {action.type === 'notify_admin' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          aria-label={`Título de la notificación ${index + 1}`}
                          placeholder="Título de la alerta"
                          value={action.config.title ?? ''}
                          onChange={(e) => updateActionConfig(index, { title: e.target.value })}
                          className="h-8 text-xs"
                          disabled={loading}
                        />
                        <Input
                          aria-label={`Cuerpo de la notificación ${index + 1}`}
                          placeholder="Detalle: {{nombre}} cambió a {{etapa}}"
                          value={action.config.body ?? ''}
                          onChange={(e) => updateActionConfig(index, { body: e.target.value })}
                          className="h-8 text-xs"
                          disabled={loading}
                        />
                      </div>
                    )}

                    {isChannelAction(action.type) && (
                      <div className="space-y-2">
                        <Select
                          value={action.config.templateId ? `tpl:${action.config.templateId}` : 'none'}
                          onValueChange={(v) => updateActionConfig(index, { templateId: v.startsWith('tpl:') ? v.slice(4) : '' })}
                          disabled={loading}
                        >
                          <SelectTrigger className="h-8 text-xs" aria-label={`Plantilla para la acción ${index + 1}`}>
                            <SelectValue placeholder="Sin plantilla (texto libre)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin plantilla (texto libre)</SelectItem>
                            {templates.map((tpl) => (
                              <SelectItem key={tpl.id} value={`tpl:${tpl.id}`}>{tpl.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Textarea
                          aria-label={`Mensaje para la acción ${index + 1}`}
                          placeholder="Hola {{nombre}}, te escribo por…"
                          value={action.config.text ?? ''}
                          onChange={(e) => updateActionConfig(index, { text: e.target.value })}
                          rows={2}
                          className="text-xs"
                          disabled={loading}
                        />
                        <p className="text-[10px] text-slate-400">
                          Usa variables como <code className="bg-slate-100 rounded px-1">{'{{nombre}}'}</code>,{' '}
                          <code className="bg-slate-100 rounded px-1">{'{{empresa}}'}</code> o{' '}
                          <code className="bg-slate-100 rounded px-1">{'{{etapa}}'}</code>
                        </p>
                      </div>
                    )}

                    {action.type === 'create_opportunity' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          aria-label={`Título de la oportunidad ${index + 1}`}
                          placeholder="Título (ej: Renovación anual)"
                          value={action.config.title ?? ''}
                          onChange={(e) => updateActionConfig(index, { title: e.target.value })}
                          className="h-8 text-xs"
                          disabled={loading}
                        />
                        <Input
                          aria-label={`Monto de la oportunidad ${index + 1}`}
                          type="number"
                          min={0}
                          placeholder="Monto estimado (COP)"
                          value={action.config.amount ?? ''}
                          onChange={(e) => updateActionConfig(index, { amount: e.target.value })}
                          className="h-8 text-xs"
                          disabled={loading}
                        />
                      </div>
                    )}

                    {action.type === 'update_client_status' && (
                      <Input
                        aria-label={`Estado del cliente ${index + 1}`}
                        placeholder="Nuevo estado (ej: activo)"
                        value={action.config.status ?? ''}
                        onChange={(e) => updateActionConfig(index, { status: e.target.value })}
                        className="h-8 text-xs"
                        disabled={loading}
                      />
                    )}

                    {action.type === 'ai_followup' && (
                      <div className="space-y-1.5">
                        <Textarea
                          aria-label={`Instrucción para el agente IA ${index + 1}`}
                          placeholder="Ej: Escribe un recordatorio amable sobre su cotización pendiente y propon una llamada de 15 minutos"
                          value={action.config.instruction ?? ''}
                          onChange={(e) => updateActionConfig(index, { instruction: e.target.value })}
                          rows={3}
                          className="text-xs"
                          disabled={loading}
                        />
                        <p className="text-[10px] text-violet-500 flex items-center gap-1">
                          <Bot className="w-3 h-3" /> El agente IA redacta el seguimiento con el contexto del cliente
                        </p>
                      </div>
                    )}

                    {action.type === 'wait' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-[10px] text-slate-400">Días</Label>
                            <Input
                              aria-label={`Días de espera de la acción ${index + 1}`}
                              type="number"
                              min={0}
                              max={60}
                              placeholder="0"
                              value={String(action.config.days ?? '')}
                              onChange={(e) => updateActionConfig(index, { days: e.target.value })}
                              className="h-8 text-xs"
                              disabled={loading}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-slate-400">Horas</Label>
                            <Input
                              aria-label={`Horas de espera de la acción ${index + 1}`}
                              type="number"
                              min={0}
                              max={72}
                              placeholder="0"
                              value={String(action.config.hours ?? '')}
                              onChange={(e) => updateActionConfig(index, { hours: e.target.value })}
                              className="h-8 text-xs"
                              disabled={loading}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-slate-400">Minutos</Label>
                            <Input
                              aria-label={`Minutos de espera de la acción ${index + 1}`}
                              type="number"
                              min={0}
                              max={720}
                              placeholder="0"
                              value={String(action.config.minutes ?? '')}
                              onChange={(e) => updateActionConfig(index, { minutes: e.target.value })}
                              className="h-8 text-xs"
                              disabled={loading}
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-amber-600 flex items-center gap-1">
                          <CalendarClock className="w-3 h-3" /> El flujo queda en espera y continúa solo (ideal: mensaje → esperar 3 días → seguimiento IA)
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Activar */}
          <div className="flex items-center gap-3">
            <Switch
              id="auto-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={loading}
            />
            <Label htmlFor="auto-active" className="cursor-pointer">Activar automatización</Label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : editAutomation?.id ? 'Actualizar' : 'Crear'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
