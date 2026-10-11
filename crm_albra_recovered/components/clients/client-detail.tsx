'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  MapPin,
  Calendar,
  Clock,
  Save,
  Plus,
  Trash2,
  MessageSquare,
  FileText,
  CalendarPlus,
  Edit3,
  Eye,
  TrendingUp,
  Tag,
  StickyNote,
  Hash,
  MapPinned,
  UserCheck,
  Sparkles,
  ChevronRight,
  AlertCircle,
  Activity,
  Database,
  CheckCircle,
  XCircle,
  ArrowRightLeft,
  FilePlus,
  MessageCircle,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { ClientFormDialog } from './client-form-dialog'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientDetail {
  id: string
  name: string
  email?: string | null
  phone: string
  identifier?: string | null
  company?: string | null
  address?: string | null
  city?: string | null
  notes?: string | null
  source: string
  tags?: string | null
  score: number
  temperature: string
  lastContactAt?: string | null
  createdAt: string
}

interface Preference {
  id: string
  category: string
  key: string
  value: string
}

interface HistoryEntry {
  id: string
  serviceType: string
  description: string
  amount?: number | null
  date: string
  notes?: string | null
}

interface Opportunity {
  id: string
  title: string
  interest: string
  estimatedValue: number
  probability: number
  stage: { id: string; name: string; color: string }
  nextAction?: string | null
  createdAt: string
}

interface Reservation {
  id: string
  title: string
  date: string
  duration: number
  status: string
  serviceType?: string | null
}

interface Quote {
  id: string
  quoteNumber: string
  status: string
  total: number
  createdAt: string
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

interface CustomFieldValueWithField {
  id: string
  fieldId: string
  entityId: string
  value?: string | null
  field: CustomFieldDef
}

interface ActivityLogEntry {
  id: string
  action: string
  entity: string
  entityId?: string | null
  description: string
  metadata?: string | null
  createdAt: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const tempConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  Frio: { label: 'Frío', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: <span className="text-xs">❄️</span> },
  Tibio: { label: 'Tibio', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: <span className="text-xs">🌤️</span> },
  Caliente: { label: 'Caliente', color: 'bg-orange-50 text-orange-700 border-orange-200', icon: <span className="text-xs">🔥</span> },
  Fuego: { label: 'Fuego', color: 'bg-red-50 text-red-700 border-red-200', icon: <span className="text-xs">🔥</span> },
}

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  web: 'Web',
  referral: 'Referido',
}

const stageColors: Record<string, string> = {
  prospeccion: 'bg-sky-100 text-sky-700',
  calificacion: 'bg-indigo-100 text-indigo-700',
  propuesta: 'bg-amber-100 text-amber-700',
  negociacion: 'bg-orange-100 text-orange-700',
  cierre: 'bg-emerald-100 text-emerald-700',
}

const statusColors: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-slate-100 text-slate-600',
  no_show: 'bg-amber-100 text-amber-700',
  pending: 'bg-sky-100 text-sky-700',
}

const statusLabels: Record<string, string> = {
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Completada',
  no_show: 'No asistió',
  pending: 'Pendiente',
}

const quoteStatusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-100 text-sky-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
}

const quoteStatusLabels: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Expirada',
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(v)

// ─── Score Ring Component ────────────────────────────────────────────────────

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const strokeWidth = 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  const color = score >= 80 ? '#10b981' : score >= 60 ? '#14b8a6' : score >= 40 ? '#f59e0b' : score >= 20 ? '#f97316' : '#ef4444'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="absolute text-xs font-bold text-slate-700">{score}</span>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ClientDetail() {
  const { selectedClientId, setView } = useAppStore()
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)

  // Tab data
  const [preferences, setPreferences] = useState<Preference[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])

  // Tab loading states
  const [prefLoading, setPrefLoading] = useState(false)
  const [histLoading, setHistLoading] = useState(false)
  const [oppLoading, setOppLoading] = useState(false)
  const [resLoading, setResLoading] = useState(false)
  const [quotesLoading, setQuotesLoading] = useState(false)

  // Custom fields state
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueWithField[]>([])
  const [cfLoading, setCfLoading] = useState(false)

  // Activity log state
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  // Dialog states
  const [showEditForm, setShowEditForm] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [activeTab, setActiveTab] = useState('general')

  // Inline edit state for General tab
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Add preference form
  const [prefCategory, setPrefCategory] = useState('')
  const [prefKey, setPrefKey] = useState('')
  const [prefValue, setPrefValue] = useState('')

  // Add history form
  const [histService, setHistService] = useState('')
  const [histDesc, setHistDesc] = useState('')
  const [histAmount, setHistAmount] = useState('')

  // ─── Data Loading ────────────────────────────────────────────────────────

  const loadClient = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setLoading(true)
      const data = await api.getClient(selectedClientId)
      setClient(data.client as ClientDetail)
    } catch {
      toast.error('Error al cargar cliente')
    } finally {
      setLoading(false)
    }
  }, [selectedClientId])

  const loadPreferences = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setPrefLoading(true)
      const data = await api.getClientPreferences(selectedClientId)
      setPreferences(data.preferences as Preference[] ?? [])
    } catch {
      // Preferences may not exist yet
    } finally {
      setPrefLoading(false)
    }
  }, [selectedClientId])

  const loadHistory = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setHistLoading(true)
      const data = await api.getClientHistory(selectedClientId)
      setHistory(data.history as HistoryEntry[] ?? [])
    } catch {
      // History may not exist yet
    } finally {
      setHistLoading(false)
    }
  }, [selectedClientId])

  const loadOpportunities = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setOppLoading(true)
      const data = await api.getOpportunities({ clientId: selectedClientId })
      setOpportunities(data.opportunities as Opportunity[] ?? [])
    } catch {
      // May fail if no opportunities
    } finally {
      setOppLoading(false)
    }
  }, [selectedClientId])

  const loadReservations = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setResLoading(true)
      const data = await api.getReservations({ clientId: selectedClientId })
      setReservations(data.reservations as Reservation[] ?? [])
    } catch {
      // May fail
    } finally {
      setResLoading(false)
    }
  }, [selectedClientId])

  const loadQuotes = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setQuotesLoading(true)
      const data = await api.getQuotes({ clientId: selectedClientId })
      setQuotes(data.quotes as Quote[] ?? [])
    } catch {
      // May fail
    } finally {
      setQuotesLoading(false)
    }
  }, [selectedClientId])

  const loadCustomFieldValues = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setCfLoading(true)
      const data = await api.getCustomFieldValues(selectedClientId)
      setCustomFieldValues((data.values as CustomFieldValueWithField[]) ?? [])
    } catch {
      // May fail
    } finally {
      setCfLoading(false)
    }
  }, [selectedClientId])

  const loadActivityLogs = useCallback(async () => {
    if (!selectedClientId) return
    try {
      setActivityLoading(true)
      const data = await api.getActivityLog({ entityId: selectedClientId, limit: '30' })
      setActivityLogs((data.logs as ActivityLogEntry[]) ?? [])
    } catch {
      // May fail
    } finally {
      setActivityLoading(false)
    }
  }, [selectedClientId])

  useEffect(() => {
    loadClient()
  }, [loadClient])

  // Lazy-load tab data when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    if (tab === 'preferences' && preferences.length === 0 && !prefLoading) loadPreferences()
    if (tab === 'history' && history.length === 0 && !histLoading) loadHistory()
    if (tab === 'opportunities' && opportunities.length === 0 && !oppLoading) loadOpportunities()
    if (tab === 'reservations' && reservations.length === 0 && !resLoading) loadReservations()
    if (tab === 'quotes' && quotes.length === 0 && !quotesLoading) loadQuotes()
    if (tab === 'custom' && customFieldValues.length === 0 && !cfLoading) loadCustomFieldValues()
    if (tab === 'activity' && activityLogs.length === 0 && !activityLoading) loadActivityLogs()
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleInlineEdit = (field: string, currentValue: string) => {
    setEditingField(field)
    setEditValue(currentValue ?? '')
  }

  const handleInlineSave = async () => {
    if (!client || !editingField) return
    try {
      await api.updateClient(client.id, { [editingField]: editValue || null })
      toast.success('Campo actualizado')
      setEditingField(null)
      setEditValue('')
      loadClient()
    } catch {
      toast.error('Error al actualizar')
    }
  }

  const handleInlineCancel = () => {
    setEditingField(null)
    setEditValue('')
  }

  const handleAddPreference = async () => {
    if (!client || !prefCategory || !prefKey || !prefValue) {
      toast.error('Completa todos los campos de preferencia')
      return
    }
    try {
      await api.updateClientPreferences(client.id, [{ category: prefCategory, key: prefKey, value: prefValue }])
      setPrefCategory('')
      setPrefKey('')
      setPrefValue('')
      toast.success('Preferencia agregada')
      loadPreferences()
    } catch {
      toast.error('Error al agregar preferencia')
    }
  }

  const handleAddHistory = async () => {
    if (!client || !histService || !histDesc) {
      toast.error('Tipo de servicio y descripción son requeridos')
      return
    }
    try {
      await api.addClientHistory(client.id, {
        serviceType: histService,
        description: histDesc,
        amount: histAmount ? parseFloat(histAmount) : null,
      })
      setHistService('')
      setHistDesc('')
      setHistAmount('')
      toast.success('Historial agregado')
      loadHistory()
    } catch {
      toast.error('Error al agregar historial')
    }
  }

  const handleDeleteClient = async () => {
    if (!client) return
    try {
      await api.deleteClient(client.id)
      toast.success('Cliente eliminado')
      setView('clients')
    } catch {
      toast.error('Error al eliminar cliente')
    }
  }

  // ─── Loading State ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-lg">Cliente no encontrado</p>
        <Button onClick={() => setView('clients')} variant="outline" className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Volver a Clientes
        </Button>
      </div>
    )
  }

  const parsedTags = client.tags ? (() => {
    try {
      return JSON.parse(client.tags) as string[]
    } catch {
      return client.tags.split(',').map(t => t.trim()).filter(Boolean)
    }
  })() : []

  const tempConf = tempConfig[client.temperature]

  // Group preferences by category
  const prefCategories = preferences.reduce<Record<string, Preference[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  // Split reservations
  const now = new Date()
  const upcomingReservations = reservations.filter(r => new Date(r.date) >= now)
  const pastReservations = reservations.filter(r => new Date(r.date) < now)

  return (
    <div className="space-y-6">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row items-start gap-4">
        {/* Back + Client Info */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => setView('clients')} className="mt-1 flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Avatar */}
            <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0">
              {client.name.charAt(0).toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900 truncate">{client.name}</h1>
                {tempConf && (
                  <Badge variant="outline" className={`text-xs border gap-1 ${tempConf.color}`}>
                    {tempConf.icon} {tempConf.label}
                  </Badge>
                )}
                <ScoreRing score={client.score} />
              </div>

              {client.company && (
                <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> {client.company}
                </p>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-slate-500">
                {client.email && (
                  <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{client.email}</span>
                )}
                <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{client.phone}</span>
                {client.city && (
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{client.city}</span>
                )}
              </div>

              {parsedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {parsedTags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-xs bg-emerald-50/50 text-emerald-700 border-emerald-100">
                      <Tag className="w-2.5 h-2.5 mr-1" />{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 lg:flex-shrink-0 lg:ml-auto">
          {/* Quick Actions */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Enviar Mensaje
                </Button>
              </TooltipTrigger>
              <TooltipContent>Enviar mensaje al cliente</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Crear Cotización
                </Button>
              </TooltipTrigger>
              <TooltipContent>Crear una nueva cotización</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <CalendarPlus className="w-3.5 h-3.5" /> Agendar Cita
                </Button>
              </TooltipTrigger>
              <TooltipContent>Agendar una nueva cita</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Separator orientation="vertical" className="h-8 mx-1 hidden sm:block" />

          <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)} className="text-xs gap-1.5">
            <Edit3 className="w-3.5 h-3.5" /> Editar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowDeleteDialog(true)} className="text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
            <Trash2 className="w-3.5 h-3.5" /> Eliminar
          </Button>
        </div>
      </div>

      {/* ─── Tabs ───────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="bg-slate-100 h-auto flex-wrap gap-1 p-1">
          <TabsTrigger value="general" className="text-xs sm:text-sm">General</TabsTrigger>
          <TabsTrigger value="opportunities" className="text-xs sm:text-sm">Oportunidades</TabsTrigger>
          <TabsTrigger value="history" className="text-xs sm:text-sm">Historial</TabsTrigger>
          <TabsTrigger value="preferences" className="text-xs sm:text-sm">Preferencias</TabsTrigger>
          <TabsTrigger value="reservations" className="text-xs sm:text-sm">Reservas</TabsTrigger>
          <TabsTrigger value="quotes" className="text-xs sm:text-sm">Cotizaciones</TabsTrigger>
          <TabsTrigger value="custom" className="text-xs sm:text-sm">Campos Custom</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm">Actividad</TabsTrigger>
        </TabsList>

        {/* ─── General Tab ───────────────────────────────────────────────── */}
        <TabsContent value="general">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-600" /> Información General
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
                {/* Nombre */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Nombre
                  </Label>
                  {editingField === 'name' ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" onClick={handleInlineSave} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">✓</Button>
                      <Button size="sm" variant="ghost" onClick={handleInlineCancel} className="h-8">✗</Button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-slate-900 hover:bg-slate-50 px-2 py-1 rounded cursor-pointer -mx-2 transition-colors group"
                      onClick={() => handleInlineEdit('name', client.name)}
                    >
                      {client.name}
                      <Edit3 className="w-3 h-3 inline ml-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Email
                  </Label>
                  {editingField === 'email' ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" onClick={handleInlineSave} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">✓</Button>
                      <Button size="sm" variant="ghost" onClick={handleInlineCancel} className="h-8">✗</Button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-slate-900 hover:bg-slate-50 px-2 py-1 rounded cursor-pointer -mx-2 transition-colors group"
                      onClick={() => handleInlineEdit('email', client.email ?? '')}
                    >
                      {client.email ?? <span className="text-slate-300">Sin email</span>}
                      <Edit3 className="w-3 h-3 inline ml-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  )}
                </div>

                {/* Teléfono */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Teléfono
                  </Label>
                  {editingField === 'phone' ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" onClick={handleInlineSave} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">✓</Button>
                      <Button size="sm" variant="ghost" onClick={handleInlineCancel} className="h-8">✗</Button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-slate-900 hover:bg-slate-50 px-2 py-1 rounded cursor-pointer -mx-2 transition-colors group"
                      onClick={() => handleInlineEdit('phone', client.phone)}
                    >
                      {client.phone}
                      <Edit3 className="w-3 h-3 inline ml-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  )}
                </div>

                {/* Cédula/ID */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Hash className="w-3 h-3" /> Cédula / ID
                  </Label>
                  {editingField === 'identifier' ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" onClick={handleInlineSave} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">✓</Button>
                      <Button size="sm" variant="ghost" onClick={handleInlineCancel} className="h-8">✗</Button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-slate-900 hover:bg-slate-50 px-2 py-1 rounded cursor-pointer -mx-2 transition-colors group"
                      onClick={() => handleInlineEdit('identifier', client.identifier ?? '')}
                    >
                      {client.identifier ?? <span className="text-slate-300">Sin identificador</span>}
                      <Edit3 className="w-3 h-3 inline ml-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  )}
                </div>

                {/* Empresa */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Empresa
                  </Label>
                  {editingField === 'company' ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" onClick={handleInlineSave} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">✓</Button>
                      <Button size="sm" variant="ghost" onClick={handleInlineCancel} className="h-8">✗</Button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-slate-900 hover:bg-slate-50 px-2 py-1 rounded cursor-pointer -mx-2 transition-colors group"
                      onClick={() => handleInlineEdit('company', client.company ?? '')}
                    >
                      {client.company ?? <span className="text-slate-300">Sin empresa</span>}
                      <Edit3 className="w-3 h-3 inline ml-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  )}
                </div>

                {/* Fuente */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400">Fuente</Label>
                  <p className="text-sm text-slate-900">
                    <Badge variant="outline" className="text-xs font-normal">
                      {sourceLabels[client.source] ?? client.source}
                    </Badge>
                  </p>
                </div>

                {/* Dirección */}
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <MapPinned className="w-3 h-3" /> Dirección
                  </Label>
                  {editingField === 'address' ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" onClick={handleInlineSave} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">✓</Button>
                      <Button size="sm" variant="ghost" onClick={handleInlineCancel} className="h-8">✗</Button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-slate-900 hover:bg-slate-50 px-2 py-1 rounded cursor-pointer -mx-2 transition-colors group"
                      onClick={() => handleInlineEdit('address', client.address ?? '')}
                    >
                      {client.address ?? <span className="text-slate-300">Sin dirección</span>}
                      <Edit3 className="w-3 h-3 inline ml-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  )}
                </div>

                {/* Ciudad */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Ciudad
                  </Label>
                  {editingField === 'city' ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-8 text-sm" autoFocus />
                      <Button size="sm" onClick={handleInlineSave} className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white">✓</Button>
                      <Button size="sm" variant="ghost" onClick={handleInlineCancel} className="h-8">✗</Button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-slate-900 hover:bg-slate-50 px-2 py-1 rounded cursor-pointer -mx-2 transition-colors group"
                      onClick={() => handleInlineEdit('city', client.city ?? '')}
                    >
                      {client.city ?? <span className="text-slate-300">Sin ciudad</span>}
                      <Edit3 className="w-3 h-3 inline ml-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  )}
                </div>

                {/* Etiquetas */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Etiquetas
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {parsedTags.length > 0 ? (
                      parsedTags.map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-xs bg-emerald-50/50 text-emerald-700 border-emerald-100">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-slate-300">Sin etiquetas</span>
                    )}
                  </div>
                </div>

                {/* Último Contacto */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Último Contacto
                  </Label>
                  <p className="text-sm text-slate-900">
                    {client.lastContactAt
                      ? formatDistanceToNow(new Date(client.lastContactAt), { addSuffix: true, locale: es })
                      : <span className="text-slate-300">Sin registro</span>}
                  </p>
                </div>

                {/* Fecha de Creación */}
                <div className="space-y-1">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Registrado
                  </Label>
                  <p className="text-sm text-slate-900">
                    {format(new Date(client.createdAt), "d 'de' MMMM, yyyy", { locale: es })}
                  </p>
                </div>
              </div>

              {/* Notas */}
              {editingField === 'notes' ? (
                <div className="mt-6 space-y-2">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <StickyNote className="w-3 h-3" /> Notas
                  </Label>
                  <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={4} autoFocus />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleInlineSave} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <Save className="w-3.5 h-3.5 mr-1" /> Guardar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleInlineCancel}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  <Label
                    className="text-xs text-slate-400 flex items-center gap-1 cursor-pointer hover:text-emerald-600 transition-colors"
                    onClick={() => handleInlineEdit('notes', client.notes ?? '')}
                  >
                    <StickyNote className="w-3 h-3" /> Notas
                    <Edit3 className="w-3 h-3 ml-1 text-slate-300" />
                  </Label>
                  {client.notes ? (
                    <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-100">
                      {client.notes}
                    </p>
                  ) : (
                    <p
                      className="text-sm text-slate-300 mt-1 cursor-pointer hover:text-slate-400 transition-colors"
                      onClick={() => handleInlineEdit('notes', '')}
                    >
                      Haz clic para agregar notas...
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Oportunidades Tab ──────────────────────────────────────────── */}
        <TabsContent value="opportunities">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-600" /> Oportunidades
              </CardTitle>
            </CardHeader>
            <CardContent>
              {oppLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : opportunities.length > 0 ? (
                <div className="space-y-3">
                  <AnimatePresence>
                    {opportunities.map((opp) => (
                      <motion.div
                        key={opp.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-4 p-4 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer group"
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-offset-2"
                          style={{ backgroundColor: opp.stage.color, ringColor: opp.stage.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{opp.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge
                              variant="outline"
                              className={`text-xs ${stageColors[opp.stage.name.toLowerCase()] ?? 'bg-slate-100 text-slate-600'}`}
                            >
                              {opp.stage.name}
                            </Badge>
                            <span className="text-xs text-slate-400">Prob: {opp.probability}%</span>
                            {opp.nextAction && (
                              <span className="text-xs text-slate-400 hidden sm:inline">
                                · Próx: {opp.nextAction}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-slate-900">{formatCurrency(opp.estimatedValue)}</p>
                          <p className="text-xs text-slate-400">
                            {format(new Date(opp.createdAt), "d MMM yyyy", { locale: es })}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="text-center py-12">
                  <TrendingUp className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No hay oportunidades para este cliente</p>
                  <p className="text-xs text-slate-300 mt-1">Las oportunidades aparecerán aquí cuando se creen</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Historial Tab ──────────────────────────────────────────────── */}
        <TabsContent value="history">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-emerald-600" /> Historial de Servicios
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Add History Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6 p-4 bg-emerald-50/50 rounded-lg border border-emerald-100">
                <Input
                  placeholder="Tipo de servicio"
                  value={histService}
                  onChange={(e) => setHistService(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  placeholder="Descripción"
                  value={histDesc}
                  onChange={(e) => setHistDesc(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  placeholder="Monto (COP)"
                  type="number"
                  value={histAmount}
                  onChange={(e) => setHistAmount(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button onClick={handleAddHistory} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
                  <Plus className="w-4 h-4 mr-1" /> Agregar
                </Button>
              </div>

              {histLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : history.length > 0 ? (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-emerald-200" />

                  <div className="space-y-0">
                    <AnimatePresence>
                      {history.map((entry) => (
                        <motion.div
                          key={entry.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex gap-4 pb-4 relative"
                        >
                          {/* Timeline dot */}
                          <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white flex-shrink-0 mt-1.5 z-10" />

                          <div className="flex-1 bg-white border border-slate-100 rounded-lg p-3 shadow-sm">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-100">
                                {entry.serviceType}
                              </Badge>
                              <span className="text-xs text-slate-400">
                                {format(new Date(entry.date), "d MMM yyyy, HH:mm", { locale: es })}
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 mt-1.5">{entry.description}</p>
                            <div className="flex items-center justify-between mt-2">
                              {entry.amount ? (
                                <p className="text-sm font-medium text-emerald-600">{formatCurrency(entry.amount)}</p>
                              ) : <span />}
                              {entry.notes && (
                                <p className="text-xs text-slate-400 truncate max-w-[200px]">{entry.notes}</p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Clock className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No hay historial de servicios</p>
                  <p className="text-xs text-slate-300 mt-1">Agrega la primera entrada con el formulario de arriba</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Preferencias Tab ───────────────────────────────────────────── */}
        <TabsContent value="preferences">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-600" /> Preferencias del Cliente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Add Preference Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6 p-4 bg-emerald-50/50 rounded-lg border border-emerald-100">
                <Input
                  placeholder="Categoría (ej: comunicación)"
                  value={prefCategory}
                  onChange={(e) => setPrefCategory(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  placeholder="Clave (ej: canal_favorito)"
                  value={prefKey}
                  onChange={(e) => setPrefKey(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  placeholder="Valor (ej: WhatsApp)"
                  value={prefValue}
                  onChange={(e) => setPrefValue(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button onClick={handleAddPreference} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
                  <Plus className="w-4 h-4 mr-1" /> Agregar
                </Button>
              </div>

              {prefLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : Object.keys(prefCategories).length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(prefCategories).map(([category, prefs]) => (
                    <div key={category} className="bg-white border border-slate-100 rounded-lg p-4 shadow-sm">
                      <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                        {category === 'comunicación' || category === 'comunicacion' ? (
                          <MessageSquare className="w-4 h-4 text-emerald-500" />
                        ) : category === 'servicio' ? (
                          <Sparkles className="w-4 h-4 text-emerald-500" />
                        ) : category === 'horario' || category === 'schedule' ? (
                          <Clock className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Tag className="w-4 h-4 text-emerald-500" />
                        )}
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                      </h4>
                      <div className="space-y-2">
                        {prefs.map((pref) => (
                          <div key={pref.id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-500 text-xs">{pref.key}:</span>
                            <span className="font-medium text-slate-900 text-xs">{pref.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Sparkles className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No hay preferencias registradas</p>
                  <p className="text-xs text-slate-300 mt-1">Agrega preferencias para personalizar la atención</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Reservas Tab ───────────────────────────────────────────────── */}
        <TabsContent value="reservations">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-600" /> Reservas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {resLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : reservations.length > 0 ? (
                <div className="space-y-6">
                  {/* Upcoming */}
                  {upcomingReservations.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                        <CalendarPlus className="w-4 h-4 text-emerald-500" /> Próximas ({upcomingReservations.length})
                      </h4>
                      <div className="space-y-2">
                        {upcomingReservations.map((res) => (
                          <div key={res.id} className="flex items-center justify-between p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg">
                            <div>
                              <p className="text-sm font-medium text-slate-900">{res.title}</p>
                              <p className="text-xs text-slate-500">
                                {format(new Date(res.date), "d MMM yyyy, HH:mm", { locale: es })} · {res.duration} min
                                {res.serviceType && ` · ${res.serviceType}`}
                              </p>
                            </div>
                            <Badge className={`text-xs ${statusColors[res.status] ?? 'bg-slate-100 text-slate-600'}`}>
                              {statusLabels[res.status] ?? res.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Past */}
                  {pastReservations.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400" /> Pasadas ({pastReservations.length})
                      </h4>
                      <div className="space-y-2">
                        {pastReservations.map((res) => (
                          <div key={res.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                            <div>
                              <p className="text-sm font-medium text-slate-700">{res.title}</p>
                              <p className="text-xs text-slate-400">
                                {format(new Date(res.date), "d MMM yyyy, HH:mm", { locale: es })} · {res.duration} min
                              </p>
                            </div>
                            <Badge className={`text-xs ${statusColors[res.status] ?? 'bg-slate-100 text-slate-600'}`}>
                              {statusLabels[res.status] ?? res.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Calendar className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No hay reservas para este cliente</p>
                  <p className="text-xs text-slate-300 mt-1">Las reservas aparecerán aquí cuando se agenden</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Cotizaciones Tab ───────────────────────────────────────────── */}
        <TabsContent value="quotes">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-600" /> Cotizaciones
              </CardTitle>
            </CardHeader>
            <CardContent>
              {quotesLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : quotes.length > 0 ? (
                <div className="space-y-2">
                  <AnimatePresence>
                    {quotes.map((q) => (
                      <motion.div
                        key={q.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center flex-shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{q.quoteNumber}</p>
                            <p className="text-xs text-slate-400">
                              {format(new Date(q.createdAt), "d MMM yyyy", { locale: es })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-sm font-semibold text-slate-900">{formatCurrency(q.total)}</p>
                          <Badge className={`text-xs ${quoteStatusColors[q.status] ?? 'bg-slate-100 text-slate-600'}`}>
                            {quoteStatusLabels[q.status] ?? q.status}
                          </Badge>
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="text-center py-12">
                  <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No hay cotizaciones para este cliente</p>
                  <p className="text-xs text-slate-300 mt-1">Las cotizaciones aparecerán aquí cuando se creen</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* ─── Custom Fields Tab ─────────────────────────────────────────── */}
        <TabsContent value="custom">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" /> Campos Personalizados
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cfLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : customFieldValues.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {customFieldValues.map((cfv) => (
                    <div key={cfv.id} className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                      <p className="text-xs text-slate-400 mb-1">{cfv.field.name}</p>
                      {cfv.field.fieldType === 'boolean' ? (
                        <div className="flex items-center gap-2">
                          {cfv.value === 'true' ? (
                            <CheckCircle className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-slate-300" />
                          )}
                          <span className="text-sm text-slate-900">{cfv.value === 'true' ? 'Sí' : 'No'}</span>
                        </div>
                      ) : cfv.field.fieldType === 'date' && cfv.value ? (
                        <p className="text-sm text-slate-900">
                          {format(new Date(cfv.value), "d 'de' MMMM, yyyy", { locale: es })}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-900">{cfv.value || <span className="text-slate-300">Sin valor</span>}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Database className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No hay campos personalizados configurados</p>
                  <p className="text-xs text-slate-300 mt-1">Configura campos en Configuración → Campos Custom</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Activity Tab ────────────────────────────────────────────────── */}
        <TabsContent value="activity">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-600" /> Registro de Actividad
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
                </div>
              ) : activityLogs.length > 0 ? (
                <div className="relative">
                  <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-emerald-200" />
                  <div className="space-y-0">
                    <AnimatePresence>
                      {activityLogs.map((log) => {
                        const actionIcon: Record<string, React.ReactNode> = {
                          created: <FilePlus className="w-3 h-3" />,
                          updated: <Edit3 className="w-3 h-3" />,
                          deleted: <Trash2 className="w-3 h-3" />,
                          stage_changed: <ArrowRightLeft className="w-3 h-3" />,
                          note_added: <StickyNote className="w-3 h-3" />,
                        }
                        const actionColor: Record<string, string> = {
                          created: 'bg-emerald-500',
                          updated: 'bg-sky-500',
                          deleted: 'bg-red-500',
                          stage_changed: 'bg-amber-500',
                          note_added: 'bg-purple-500',
                        }
                        return (
                          <motion.div
                            key={log.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-start gap-4 py-3 pl-6 relative"
                          >
                            <div className={`absolute left-0 top-4 w-4 h-4 rounded-full ${actionColor[log.action] || 'bg-slate-400'} text-white flex items-center justify-center ring-2 ring-white`}>
                              {actionIcon[log.action] || <Activity className="w-3 h-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-700">{log.description}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-[10px]">{log.action}</Badge>
                                <Badge variant="outline" className="text-[10px]">{log.entity}</Badge>
                                <span className="text-xs text-slate-400">
                                  {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: es })}
                                </span>
                              </div>
                            </div>
                          </motion.div>
                        )
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Activity className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No hay actividad registrada</p>
                  <p className="text-xs text-slate-300 mt-1">La actividad aparecerá aquí al interactuar con este cliente</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Edit Form Dialog ──────────────────────────────────────────────── */}
      <ClientFormDialog
        open={showEditForm}
        onClose={() => { setShowEditForm(false); loadClient() }}
        editClient={client}
      />

      {/* ─── Delete Confirmation ───────────────────────────────────────────── */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente el cliente{' '}
              <span className="font-semibold text-slate-700">{client.name}</span> y todos sus datos asociados,
              incluyendo oportunidades, historial, preferencias, reservas y cotizaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteClient}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Eliminar Cliente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
