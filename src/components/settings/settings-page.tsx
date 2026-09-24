'use client'

import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Settings,
  Key,
  Globe,
  Brain,
  CheckCircle,
  XCircle,
  Loader2,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Zap,
  AlertTriangle,
  RefreshCw,
  MessageCircle,
  Wifi,
  WifiOff,
  Smartphone,
  QrCode,
  Unplug,
  Building2,
  Plus,
  X,
  Sparkles,
  Percent,
  Send,
  Mail,
  Calendar,
  Table,
  Cloud,
  Bot,
  ToggleLeft,
  ToggleRight,
  Database,
  ArrowRightLeft,
  Clock,
  Users,
  Shield,
  UserPlus,
  Download,
  Upload,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { TemplatesTab } from './templates-tab'
import { CustomFieldsTab } from './custom-fields-tab'
import { CurrencySelector } from './currency-selector'
// Force recompile trigger

// Use the Next.js API proxy to reach WhatsApp daemon (works from any hostname)
const DAEMON_PROXY = '/api/whatsapp/daemon-proxy'

interface TeamMember {
  id: string
  name: string
  email: string
  role: string
  phone?: string
  isActive: boolean
  createdAt: string
  _count?: { clients: number; opportunities: number }
}

interface LlmSettings {
  apiKeyConfigured: boolean
  apiKeyPreview: string
  baseUrl: string
  model: string
}

interface AppSettings {
  name: string
  url: string
}

interface SystemInfo {
  usingZaiSdk: boolean
  provider: string
  chatEnabled: boolean
}

interface SettingsData {
  llm: LlmSettings
  email: {
    configured: boolean
    host: string
    fromName: string
  }
  app: AppSettings
  system: SystemInfo
}

interface WaStatus {
  status: string // disconnected, connecting, waiting_qr, connected
  phone: string | null
  lastUpdate: string | null
}

interface WaQrData {
  status: string
  qr: string | null // base64 data URL
  qrText?: string | null
  phone?: string | null
}

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    description: 'GPT-4o, GPT-4o-mini, GPT-3.5',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    description: 'Llama 3.3, Mixtral (ultra rápido)',
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
    description: 'Llama 3, Mixtral',
  },
  {
    id: 'custom',
    name: 'Personalizado',
    baseUrl: '',
    models: [],
    description: 'Cualquier API compatible con OpenAI',
  },
]

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state - LLM
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('openai')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4o-mini')
  const [customModel, setCustomModel] = useState('')

  // WhatsApp state
  const [waStatus, setWaStatus] = useState<WaStatus>({ status: 'disconnected', phone: null, lastUpdate: null })
  const [waQr, setWaQr] = useState<WaQrData>({ status: 'disconnected', qr: null })
  const [waLoading, setWaLoading] = useState(false)
  const [waPolling, setWaPolling] = useState(false)

  // Nicho / Negocio state
  const [nichoBrand, setNichoBrand] = useState('')
  const [nichoRubro, setNichoRubro] = useState('')
  const [nichoPersonality, setNichoPersonality] = useState('')
  const [nichoRolPrimario, setNichoRolPrimario] = useState('Cliente')
  const [nichoRolSecundario, setNichoRolSecundario] = useState('Asesor')
  const [nichoEvento, setNichoEvento] = useState('Cita')
  const [nichoEventoPlural, setNichoEventoPlural] = useState('Citas')
  const [nichoReglas, setNichoReglas] = useState<string[]>([])
  const [nichoDescuento, setNichoDescuento] = useState(10)
  const [nichoEstrategia, setNichoEstrategia] = useState('')
  const [nichoSaving, setNichoSaving] = useState(false)
  const [nichoLoaded, setNichoLoaded] = useState(false)

  // Telegram state
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgConnected, setTgConnected] = useState(false)
  const [tgAutoReply, setTgAutoReply] = useState(true)
  const [tgBotUsername, setTgBotUsername] = useState<string | null>(null)
  const [tgLoading, setTgLoading] = useState(false)

  // Google state
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleScopes, setGoogleScopes] = useState<string[]>([])
  const [googleLoading, setGoogleLoading] = useState(false)

  // Inventory state
  const [invSpreadsheetId, setInvSpreadsheetId] = useState('')
  const [invSheetName, setInvSheetName] = useState('Inventario')
  const [invRange, setInvRange] = useState('A1:Z1000')
  const [invColumnMap, setInvColumnMap] = useState({ name: 0, description: 1, category: 2, price: 3, duration: 4 })
  const [invSyncInterval, setInvSyncInterval] = useState(60)
  const [invActive, setInvActive] = useState(false)
  const [invLastSync, setInvLastSync] = useState<string | null>(null)
  const [invLastResult, setInvLastResult] = useState<Record<string, number> | null>(null)
  const [invLoading, setInvLoading] = useState(false)

  // Email state
  const [emailTestAddr, setEmailTestAddr] = useState('')
  const [emailTesting, setEmailTesting] = useState(false)

  // Team state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', password: '', role: 'agent' as 'admin' | 'agent' })
  const [inviteLoading, setInviteLoading] = useState(false)

  useEffect(() => {
    loadSettings()
    loadWaStatus()
    loadNicho()
    loadTelegramConfig()
    loadGoogleConfig()
    loadInventoryConfig()
    loadTeam()
  }, [])

  // Auto-poll QR when waiting
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    if (waStatus.status === 'waiting_qr' || waStatus.status === 'connecting') {
      interval = setInterval(() => {
        loadWaQr()
        loadWaStatus()
      }, 3000)
      setWaPolling(true)
    } else {
      setWaPolling(false)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [waStatus.status])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const data = await api.getSettings() as SettingsData
      setSettings(data)
      setBaseUrl(data.llm.baseUrl)
      setModel(data.llm.model)

      const provider = PROVIDERS.find(p => p.baseUrl === data.llm.baseUrl)
      setSelectedProvider(provider?.id ?? 'custom')
    } catch {
      toast.error('Error al cargar configuración')
    } finally {
      setLoading(false)
    }
  }

  const loadWaStatus = async () => {
    try {
      const res = await fetch(`${DAEMON_PROXY}?path=/status`)
      const data = await res.json() as WaStatus
      setWaStatus(data)
    } catch {
      setWaStatus({ status: 'disconnected', phone: null, lastUpdate: null })
    }
  }

  const loadWaQr = async () => {
    try {
      const res = await fetch(`${DAEMON_PROXY}?path=/qr`)
      const data = await res.json() as WaQrData
      setWaQr(data)
      if (data.status === 'connected') {
        setWaStatus(prev => ({ ...prev, status: 'connected', phone: data.phone ?? null }))
      }
    } catch {
      // Daemon not reachable
    }
  }

  const handleWaConnect = async () => {
    setWaLoading(true)
    try {
      await fetch(DAEMON_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/connect' }),
      })
      // Wait a moment then start polling
      await new Promise(r => setTimeout(r, 2000))
      await loadWaStatus()
      await loadWaQr()
      toast.success('Generando código QR...')
    } catch {
      toast.error('Error al conectar con WhatsApp')
    } finally {
      setWaLoading(false)
    }
  }

  const handleWaDisconnect = async () => {
    setWaLoading(true)
    try {
      await fetch(DAEMON_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/disconnect' }),
      })
      setWaStatus({ status: 'disconnected', phone: null, lastUpdate: null })
      setWaQr({ status: 'disconnected', qr: null })
      toast.success('WhatsApp desconectado')
    } catch {
      toast.error('Error al desconectar')
    } finally {
      setWaLoading(false)
    }
  }

  const loadNicho = async () => {
    try {
      const res = await fetch('/api/nicho')
      if (!res.ok) return
      const data = await res.json()
      setNichoBrand(data.branding_name || '')
      setNichoRubro(data.rubro || '')
      setNichoPersonality(data.personality || '')
      setNichoRolPrimario(data.terminology?.rol_primario || 'Cliente')
      setNichoRolSecundario(data.terminology?.rol_secundario || 'Asesor')
      setNichoEvento(data.terminology?.evento || 'Cita')
      setNichoEventoPlural(data.terminology?.evento_plural || 'Citas')
      setNichoReglas(data.reglas_oro || [])
      setNichoDescuento(data.negociacion?.descuento_maximo ?? 10)
      setNichoEstrategia(data.negociacion?.estrategia || '')
      setNichoLoaded(true)
    } catch {
      // nicho.json may not exist yet
    }
  }

  const handleSaveNicho = async () => {
    setNichoSaving(true)
    try {
      const res = await fetch('/api/nicho', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branding_name: nichoBrand,
          rubro: nichoRubro,
          personality: nichoPersonality,
          terminology: {
            rol_primario: nichoRolPrimario,
            rol_secundario: nichoRolSecundario,
            evento: nichoEvento,
            evento_plural: nichoEventoPlural,
          },
          reglas_oro: nichoReglas,
          negociacion: {
            descuento_maximo: nichoDescuento,
            estrategia: nichoEstrategia,
          },
        }),
      })
      if (!res.ok) throw new Error('Error al guardar')
      toast.success('Configuración del negocio guardada', {
        description: 'El agente IA usará estos valores en sus respuestas.',
      })
    } catch {
      toast.error('Error al guardar configuración del negocio')
    } finally {
      setNichoSaving(false)
    }
  }

  const addRegla = () => setNichoReglas([...nichoReglas, ''])
  const removeRegla = (i: number) => setNichoReglas(nichoReglas.filter((_, idx) => idx !== i))
  const updateRegla = (i: number, val: string) => {
    const copy = [...nichoReglas]
    copy[i] = val
    setNichoReglas(copy)
  }

  // ============ Telegram handlers ============
  const loadTelegramConfig = async () => {
    try {
      const data = await api.getTelegramConfig() as { configured: boolean; config?: { isActive: boolean; autoReply: boolean; botUsername?: string; hasBotToken: boolean } }
      if (data.configured && data.config) {
        setTgConnected(data.config.isActive)
        setTgAutoReply(data.config.autoReply)
        setTgBotUsername(data.config.botUsername ?? null)
      }
    } catch {
      // Not configured yet
    }
  }

  const handleTelegramConnect = async () => {
    if (!tgBotToken.trim()) {
      toast.error('Ingresa el Bot Token')
      return
    }
    setTgLoading(true)
    try {
      await api.saveTelegramConfig({ botToken: tgBotToken, autoReply: tgAutoReply })
      const result = await api.setTelegramWebhook() as { success: boolean; botUsername?: string; error?: string }
      if (result.success) {
        setTgConnected(true)
        setTgBotUsername(result.botUsername ?? null)
        setTgBotToken('')
        toast.success('Telegram conectado', { description: result.botUsername ? `Bot @${result.botUsername} vinculado` : 'Webhook configurado' })
      } else {
        toast.error(result.error || 'Error al configurar webhook')
      }
    } catch (err) {
      toast.error('Error al conectar Telegram. Verifica el token.')
    } finally {
      setTgLoading(false)
    }
  }

  const handleTelegramDisconnect = async () => {
    setTgLoading(true)
    try {
      await api.disconnectTelegram()
      setTgConnected(false)
      setTgBotUsername(null)
      toast.success('Telegram desconectado')
    } catch {
      toast.error('Error al desconectar Telegram')
    } finally {
      setTgLoading(false)
    }
  }

  // ============ Google handlers ============
  const loadGoogleConfig = async () => {
    try {
      const data = await api.getGoogleConfig() as { configured: boolean; connected: boolean; config?: { scopes?: string[] } }
      setGoogleConnected(data.connected)
      if (data.config?.scopes) {
        setGoogleScopes(data.config.scopes)
      }
    } catch {
      // Not configured yet
    }
  }

  const handleGoogleSaveAndConnect = async () => {
    if (!googleClientId.trim() || !googleClientSecret.trim()) {
      toast.error('Ingresa Client ID y Client Secret')
      return
    }
    setGoogleLoading(true)
    try {
      await api.saveGoogleConfig({ clientId: googleClientId, clientSecret: googleClientSecret })
      // Redirect to Google OAuth
      window.location.href = '/api/google/auth'
    } catch {
      toast.error('Error al guardar configuración de Google')
      setGoogleLoading(false)
    }
  }

  const handleGoogleDisconnect = async () => {
    setGoogleLoading(true)
    try {
      await api.disconnectGoogle()
      setGoogleConnected(false)
      setGoogleScopes([])
      toast.success('Cuenta de Google desconectada')
    } catch {
      toast.error('Error al desconectar Google')
    } finally {
      setGoogleLoading(false)
    }
  }

  // ============ Inventory handlers ============
  const loadInventoryConfig = async () => {
    try {
      const data = await api.getInventoryConfig() as { configured: boolean; config?: { spreadsheetId: string; sheetName: string; range: string; columnMap: Record<string, number>; syncInterval: number; isActive: boolean; lastSyncAt: string | null; lastSyncResult: Record<string, number> | null } }
      if (data.configured && data.config) {
        setInvSpreadsheetId(data.config.spreadsheetId)
        setInvSheetName(data.config.sheetName)
        setInvRange(data.config.range)
        if (data.config.columnMap) setInvColumnMap(data.config.columnMap)
        setInvSyncInterval(data.config.syncInterval)
        setInvActive(data.config.isActive)
        setInvLastSync(data.config.lastSyncAt)
        setInvLastResult(data.config.lastSyncResult)
      }
    } catch {
      // Not configured yet
    }
  }

  const handleInventorySave = async () => {
    if (!invSpreadsheetId.trim()) {
      toast.error('Ingresa el Spreadsheet ID')
      return
    }
    setInvLoading(true)
    try {
      await api.saveInventoryConfig({
        spreadsheetId: invSpreadsheetId,
        sheetName: invSheetName,
        range: invRange,
        columnMap: invColumnMap,
        syncInterval: invSyncInterval,
        isActive: invActive,
      })
      toast.success('Configuración de inventario guardada')
    } catch {
      toast.error('Error al guardar configuración de inventario')
    } finally {
      setInvLoading(false)
    }
  }

  const handleInventorySync = async () => {
    setInvLoading(true)
    try {
      const result = await api.syncInventory() as { success: boolean; summary: { created: number; updated: number; skipped: number; errors: number } }
      if (result.success) {
        setInvLastSync(new Date().toISOString())
        setInvLastResult(result.summary)
        toast.success('Sincronización completada', {
          description: `Creados: ${result.summary.created}, Actualizados: ${result.summary.updated}, Errores: ${result.summary.errors}`,
        })
      }
    } catch (err) {
      toast.error('Error al sincronizar inventario')
    } finally {
      setInvLoading(false)
    }
  }

  // ============ Email handlers ============
  const handleTestEmail = async () => {
    if (!emailTestAddr.trim()) {
      toast.error('Ingresa un email de destino')
      return
    }
    setEmailTesting(true)
    try {
      await api.testEmail(emailTestAddr)
      toast.success('Email de prueba enviado', { description: `Revisa la bandeja de ${emailTestAddr}` })
    } catch (err) {
      toast.error('Error al enviar email de prueba')
    } finally {
      setEmailTesting(false)
    }
  }

  // ============ Team handlers ============
  const loadTeam = async () => {
    setTeamLoading(true)
    try {
      const data = await api.getTeam() as { members: TeamMember[] }
      setTeamMembers(data.members || [])
    } catch {
      // Not admin or error
    } finally {
      setTeamLoading(false)
    }
  }

  const handleInviteMember = async () => {
    if (!inviteForm.name || !inviteForm.email || !inviteForm.password) {
      toast.error('Completa todos los campos')
      return
    }
    setInviteLoading(true)
    try {
      await api.inviteTeamMember(inviteForm)
      toast.success('Miembro invitado exitosamente')
      setShowInviteDialog(false)
      setInviteForm({ name: '', email: '', password: '', role: 'agent' })
      loadTeam()
    } catch (err) {
      toast.error('Error al invitar miembro')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleDeactivateMember = async (id: string) => {
    if (!confirm('Desactivar este miembro?')) return
    try {
      await api.deactivateTeamMember(id)
      toast.success('Miembro desactivado')
      loadTeam()
    } catch {
      toast.error('Error al desactivar miembro')
    }
  }

  const handleProviderChange = (providerId: string) => {
    setSelectedProvider(providerId)
    const provider = PROVIDERS.find(p => p.id === providerId)
    if (provider && provider.baseUrl) {
      setBaseUrl(provider.baseUrl)
      if (provider.models.length > 0) {
        setModel(provider.models[0])
      }
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const finalModel = selectedProvider === 'custom' ? customModel : model

      await api.updateSettings({
        llm: {
          apiKey: apiKey || undefined,
          baseUrl,
          model: finalModel,
        },
      })

      toast.success('Configuración guardada', {
        description: 'Los cambios tendrán efecto en la próxima solicitud al chat.',
      })

      setApiKey('')
      await loadSettings()
    } catch {
      toast.error('Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  const handleClearApiKey = async () => {
    try {
      await api.clearSettingsApiKey()
      toast.success('API Key eliminada', {
        description: 'Se usará el SDK integrado (z-ai-web-dev-sdk).',
      })
      setApiKey('')
      await loadSettings()
    } catch {
      toast.error('Error al eliminar API key')
    }
  }

  const currentProvider = PROVIDERS.find(p => p.id === selectedProvider)
  const isConfigured = settings?.llm.apiKeyConfigured
  const isWaConnected = waStatus.status === 'connected'
  const isWaWaitingQr = waStatus.status === 'waiting_qr'
  const isWaConnecting = waStatus.status === 'connecting'

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configuración</h1>
          <p className="text-sm text-slate-500 mt-1">Configura las APIs y servicios</p>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
            <p className="text-sm text-slate-500 mt-3">Cargando configuración...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configuración</h1>
        <p className="text-sm text-slate-500 mt-1">Configura las APIs y servicios del CRM</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="llm" className="w-full">
        <TabsList className="bg-slate-100 h-10">
          <TabsTrigger value="llm" className="gap-1.5 text-xs">
            <Brain className="w-3.5 h-3.5" /> Chat AI
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5 text-xs">
            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
          </TabsTrigger>
          <TabsTrigger value="negocio" className="gap-1.5 text-xs">
            <Building2 className="w-3.5 h-3.5" /> Negocio
          </TabsTrigger>
          <TabsTrigger value="telegram" className="gap-1.5 text-xs">
            <Send className="w-3.5 h-3.5" /> Telegram
          </TabsTrigger>
          <TabsTrigger value="google" className="gap-1.5 text-xs">
            <Cloud className="w-3.5 h-3.5" /> Google
          </TabsTrigger>
          <TabsTrigger value="inventario" className="gap-1.5 text-xs">
            <Table className="w-3.5 h-3.5" /> Inventario
          </TabsTrigger>
          <TabsTrigger value="plantillas" className="gap-1.5 text-xs">
            <Mail className="w-3.5 h-3.5" /> Plantillas
          </TabsTrigger>
          <TabsTrigger value="custom-fields" className="gap-1.5 text-xs">
            <Database className="w-3.5 h-3.5" /> Campos Custom
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5 text-xs">
            <Mail className="w-3.5 h-3.5" /> Email SMTP
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-1.5 text-xs">
            <Users className="w-3.5 h-3.5" /> Equipo
          </TabsTrigger>
          <TabsTrigger value="backup" className="gap-1.5 text-xs">
            <Database className="w-3.5 h-3.5" /> Respaldo
          </TabsTrigger>
        </TabsList>

        {/* ============ TAB: Chat AI / LLM ============ */}
        <TabsContent value="llm" className="space-y-6 mt-4">
          {/* Status Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className={`border-0 shadow-sm ${isConfigured ? 'bg-emerald-50/50' : 'bg-amber-50/50'}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isConfigured ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                    {isConfigured ? (
                      <CheckCircle className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-6 h-6 text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold ${isConfigured ? 'text-emerald-900' : 'text-amber-900'}`}>
                      {isConfigured ? 'Chat AI Configurado' : 'Chat AI Sin Configurar'}
                    </h3>
                    <p className={`text-sm mt-1 ${isConfigured ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {isConfigured
                        ? `Usando ${settings?.system.provider}. El chat está funcionando con tu API key.`
                        : 'El Chat AI usa el SDK integrado. Configura tu propia API key para usar un proveedor externo.'}
                    </p>
                    {settings?.llm.apiKeyConfigured && settings.llm.apiKeyPreview && (
                      <p className="text-xs text-emerald-600 mt-2 font-mono">
                        Key: {settings.llm.apiKeyPreview}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className={isConfigured ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-amber-200 text-amber-700 bg-amber-50'}>
                    {isConfigured ? 'Activo' : 'SDK Default'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* LLM Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.06 }}
          >
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center">
                    <Brain className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Modelo de Lenguaje (LLM)</CardTitle>
                    <CardDescription>Configura el proveedor y modelo para el Chat AI</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Provider Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Proveedor</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {PROVIDERS.map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => handleProviderChange(provider.id)}
                        className={`p-4 rounded-xl border-2 text-left transition-all duration-200 ${
                          selectedProvider === provider.id
                            ? 'border-emerald-500 bg-emerald-50/50 shadow-sm'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Globe className="w-4 h-4 text-slate-500" />
                          <span className="font-semibold text-sm text-slate-900">{provider.name}</span>
                        </div>
                        <p className="text-xs text-slate-500">{provider.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* API Key */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Key className="w-4 h-4 text-slate-500" />
                    API Key
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={settings?.llm.apiKeyConfigured ? 'Dejar vacío para mantener la actual' : 'sk-... o gsk_... o tu API key'}
                        className="pr-10 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {settings?.llm.apiKeyConfigured && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={handleClearApiKey}
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200 flex-shrink-0"
                        title="Eliminar API Key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Tu API key se almacena localmente en el servidor. Nunca se comparte.
                  </p>
                </div>

                {/* Base URL */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Globe className="w-4 h-4 text-slate-500" />
                    Base URL
                  </Label>
                  <Input
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    disabled={selectedProvider !== 'custom'}
                    className="font-mono text-sm"
                  />
                  {selectedProvider !== 'custom' && (
                    <p className="text-xs text-slate-400">
                      Se configura automáticamente según el proveedor seleccionado.
                    </p>
                  )}
                </div>

                {/* Model */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Brain className="w-4 h-4 text-slate-500" />
                    Modelo
                  </Label>
                  {currentProvider && currentProvider.models.length > 0 ? (
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Selecciona un modelo" />
                      </SelectTrigger>
                      <SelectContent>
                        {currentProvider.models.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      placeholder="nombre-del-modelo"
                      className="font-mono text-sm"
                    />
                  )}
                </div>

                {/* Save Button */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Los cambios se aplican en la próxima solicitud al chat</span>
                  </div>
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/25"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Guardar Configuración
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ============ TAB: WhatsApp ============ */}
        <TabsContent value="whatsapp" className="space-y-6 mt-4">
          {/* Connection Status Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className={`border-0 shadow-sm ${isWaConnected ? 'bg-emerald-50/50' : isWaWaitingQr ? 'bg-amber-50/50' : 'bg-slate-50/50'}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isWaConnected ? 'bg-emerald-100' : isWaWaitingQr ? 'bg-amber-100' : 'bg-slate-100'
                  }`}>
                    {isWaConnected ? (
                      <Wifi className="w-6 h-6 text-emerald-600" />
                    ) : isWaWaitingQr ? (
                      <QrCode className="w-6 h-6 text-amber-600" />
                    ) : (
                      <WifiOff className="w-6 h-6 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold ${
                      isWaConnected ? 'text-emerald-900' : isWaWaitingQr ? 'text-amber-900' : 'text-slate-700'
                    }`}>
                      {isWaConnected
                        ? 'WhatsApp Conectado'
                        : isWaWaitingQr
                          ? 'Esperando Escaneo de QR'
                          : 'WhatsApp Desconectado'}
                    </h3>
                    <p className={`text-sm mt-1 ${
                      isWaConnected ? 'text-emerald-700' : isWaWaitingQr ? 'text-amber-700' : 'text-slate-500'
                    }`}>
                      {isWaConnected
                        ? `Conectado como ${waStatus.phone}. El agente IA puede responder automáticamente.`
                        : isWaWaitingQr
                          ? 'Escanea el código QR con tu WhatsApp para conectar.'
                          : 'Conecta tu WhatsApp escaneando un código QR. Sin necesidad de API de Meta.'}
                    </p>
                    {waStatus.lastUpdate && (
                      <p className="text-xs text-slate-400 mt-1">
                        Última actualización: {new Date(waStatus.lastUpdate).toLocaleTimeString('es')}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className={
                    isWaConnected
                      ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                      : isWaWaitingQr
                        ? 'border-amber-200 text-amber-700 bg-amber-50'
                        : 'border-slate-200 text-slate-500'
                  }>
                    {isWaConnected ? 'Online' : isWaWaitingQr ? 'QR Listo' : isWaConnecting ? 'Conectando...' : 'Offline'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* QR Code / Connection Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.06 }}
          >
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Conexión por QR</CardTitle>
                    <CardDescription>Escanea con tu WhatsApp Web para conectar</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center">
                  {isWaConnected ? (
                    /* Connected state */
                    <div className="text-center py-6">
                      <div className="w-20 h-20 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-10 h-10 text-emerald-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-emerald-900 mb-1">Conectado</h3>
                      <p className="text-sm text-emerald-700 mb-1">{waStatus.phone}</p>
                      <p className="text-xs text-slate-400 mb-4">Tu WhatsApp está vinculado al CRM</p>
                      <Button
                        variant="outline"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 gap-2"
                        onClick={handleWaDisconnect}
                        disabled={waLoading}
                      >
                        <Unplug className="w-4 h-4" />
                        Desconectar WhatsApp
                      </Button>
                    </div>
                  ) : isWaWaitingQr || isWaConnecting ? (
                    /* QR Code display */
                    <div className="text-center py-4">
                      {waQr.qr ? (
                        <>
                          <div className="bg-white p-4 rounded-2xl shadow-lg border border-slate-200 mb-4 inline-block">
                            <img
                              src={waQr.qr}
                              alt="WhatsApp QR Code"
                              className="w-64 h-64"
                            />
                          </div>
                          <p className="text-sm text-slate-600 font-medium mb-1">
                            Escanea este código con WhatsApp
                          </p>
                          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mb-3">
                            {waPolling && <Loader2 className="w-3 h-3 animate-spin" />}
                            <span>Actualizando automáticamente...</span>
                          </div>
                        </>
                      ) : (
                        <div className="py-10">
                          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-3" />
                          <p className="text-sm text-slate-500">Generando código QR...</p>
                        </div>
                      )}
                      <div className="flex gap-2 justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadWaQr}
                          className="gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Refrescar QR
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700 gap-1.5"
                          onClick={handleWaDisconnect}
                          disabled={waLoading}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Disconnected state */
                    <div className="text-center py-6">
                      <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <QrCode className="w-10 h-10 text-slate-300" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-700 mb-2">Sin conexión</h3>
                      <p className="text-sm text-slate-400 max-w-sm mx-auto mb-4">
                        Haz clic en Conectar para generar un código QR. Escanea con tu WhatsApp para vincular.
                      </p>
                      <Button
                        onClick={handleWaConnect}
                        disabled={waLoading}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/25 gap-2"
                      >
                        {waLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wifi className="w-4 h-4" />
                        )}
                        Conectar WhatsApp
                      </Button>
                    </div>
                  )}
                </div>

                {/* Steps guide */}
                {!isWaConnected && (
                  <>
                    <Separator className="my-4" />
                    <div className="space-y-2.5">
                      <h4 className="text-sm font-semibold text-slate-700">Cómo conectar:</h4>
                      <div className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                        <p className="text-sm text-slate-600">Haz clic en <strong>"Conectar WhatsApp"</strong></p>
                      </div>
                      <div className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                        <p className="text-sm text-slate-600">Abre <strong>WhatsApp</strong> en tu teléfono</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                        <p className="text-sm text-slate-600">Ve a <strong>Dispositivos vinculados</strong> → Vincular dispositivo</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                        <p className="text-sm text-slate-600"><strong>Escanea el código QR</strong> que aparece en pantalla</p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* WhatsApp Features Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
          >
            <Card className="border-0 shadow-sm">
              <CardContent className="p-5">
                <h4 className="font-semibold text-sm text-slate-900 mb-3">Capacidades del WhatsApp Agentic</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-emerald-50 rounded-xl p-3">
                    <MessageCircle className="w-5 h-5 text-emerald-600 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Auto-respuesta IA</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">El agente responde y califica prospectos 24/7</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3">
                    <Zap className="w-5 h-5 text-amber-500 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Transferencia humana</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Pasa a un humano cuando el agente no pueda</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3">
                    <RefreshCw className="w-5 h-5 text-blue-500 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Seguimiento auto</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Follow-up programado hasta cerrar la venta</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
        {/* ============ TAB: Negocio / Nicho ============ */}
        <TabsContent value="negocio" className="space-y-6 mt-4">
          {/* Currency Selector */}
          <CurrencySelector />

          {/* Branding Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Identidad del Negocio</CardTitle>
                    <CardDescription>Nombre, rubro y personalidad del agente IA</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Nombre del Negocio</Label>
                  <Input
                    value={nichoBrand}
                    onChange={(e) => setNichoBrand(e.target.value)}
                    placeholder="Ej: CRM ALBRA"
                    className="text-sm"
                  />
                  <p className="text-xs text-slate-400">El agente se presentará con este nombre</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Rubro / Industria</Label>
                  <Input
                    value={nichoRubro}
                    onChange={(e) => setNichoRubro(e.target.value)}
                    placeholder="Ej: Servicios Profesionales, Bienes Raices, Tienda Online..."
                    className="text-sm"
                  />
                  <p className="text-xs text-slate-400">Define el sector para que el agente use vocabulario adecuado</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-500" /> Personalidad del Agente
                  </Label>
                  <textarea
                    value={nichoPersonality}
                    onChange={(e) => setNichoPersonality(e.target.value)}
                    placeholder="Ej: Profesional, empático y orientado a resultados. Comunicación cercana pero respetuosa."
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  />
                  <p className="text-xs text-slate-400">Describe el tono y estilo de comunicación del agente IA</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Terminology Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.06 }}
          >
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <Globe className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Terminología</CardTitle>
                    <CardDescription>Personaliza cómo el agente nombra cada concepto</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Rol Primario</Label>
                    <Input
                      value={nichoRolPrimario}
                      onChange={(e) => setNichoRolPrimario(e.target.value)}
                      placeholder="Cliente"
                      className="text-sm"
                    />
                    <p className="text-xs text-slate-400">Como llama a tus contactos</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Rol Secundario</Label>
                    <Input
                      value={nichoRolSecundario}
                      onChange={(e) => setNichoRolSecundario(e.target.value)}
                      placeholder="Asesor"
                      className="text-sm"
                    />
                    <p className="text-xs text-slate-400">Como se llama a si mismo</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Evento (singular)</Label>
                    <Input
                      value={nichoEvento}
                      onChange={(e) => setNichoEvento(e.target.value)}
                      placeholder="Cita"
                      className="text-sm"
                    />
                    <p className="text-xs text-slate-400">Ej: Cita, Reunión, Consulta</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Evento (plural)</Label>
                    <Input
                      value={nichoEventoPlural}
                      onChange={(e) => setNichoEventoPlural(e.target.value)}
                      placeholder="Citas"
                      className="text-sm"
                    />
                    <p className="text-xs text-slate-400">Ej: Citas, Reuniones, Consultas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Golden Rules Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
          >
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                    <Zap className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Reglas de Oro</CardTitle>
                    <CardDescription>Reglas que el agente SIEMPRE debe seguir</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {nichoReglas.map((regla, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1.5">
                      {i + 1}
                    </span>
                    <Input
                      value={regla}
                      onChange={(e) => updateRegla(i, e.target.value)}
                      placeholder="Escribe una regla..."
                      className="text-sm flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRegla(i)}
                      className="text-slate-400 hover:text-red-500 h-9 w-9 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addRegla}
                  className="gap-1.5 text-xs mt-2"
                >
                  <Plus className="w-3.5 h-3.5" /> Agregar Regla
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* Negotiation Card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.18 }}
          >
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center">
                    <Percent className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Negociación</CardTitle>
                    <CardDescription>Límites y estrategia para cerrar ventas</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Percent className="w-4 h-4 text-slate-500" /> Descuento Máximo (%)
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={nichoDescuento}
                      onChange={(e) => setNichoDescuento(Number(e.target.value))}
                      className="text-sm w-24"
                    />
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 rounded-full transition-all"
                        style={{ width: `${Math.min(nichoDescuento, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono text-slate-500 w-10 text-right">{nichoDescuento}%</span>
                  </div>
                  <p className="text-xs text-slate-400">El agente nunca ofrecerá un descuento mayor a este porcentaje</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Estrategia de Negociación</Label>
                  <textarea
                    value={nichoEstrategia}
                    onChange={(e) => setNichoEstrategia(e.target.value)}
                    placeholder="Ej: Ofrecer descuento parcial primero, mantener margen"
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                  />
                  <p className="text-xs text-slate-400">Describe cómo debe negociar el agente ante solicitudes de descuento</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSaveNicho}
              disabled={nichoSaving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/25"
            >
              {nichoSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Guardar Negocio
                </>
              )}
            </Button>
          </div>
        </TabsContent>
        {/* ============ TAB: Telegram ============ */}
        <TabsContent value="telegram" className="space-y-6 mt-4">
          {/* Status Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className={`border-0 shadow-sm ${tgConnected ? 'bg-emerald-50/50' : 'bg-slate-50/50'}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${tgConnected ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    {tgConnected ? <CheckCircle className="w-6 h-6 text-emerald-600" /> : <Bot className="w-6 h-6 text-slate-400" />}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold ${tgConnected ? 'text-emerald-900' : 'text-slate-700'}`}>
                      {tgConnected ? 'Telegram Conectado' : 'Telegram Sin Conectar'}
                    </h3>
                    <p className={`text-sm mt-1 ${tgConnected ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {tgConnected
                        ? `Bot ${tgBotUsername ? `@${tgBotUsername}` : ''} vinculado. El agente IA puede responder automáticamente.`
                        : 'Conecta tu bot de Telegram para recibir y responder mensajes automáticamente.'}
                    </p>
                  </div>
                  <Badge variant="outline" className={tgConnected ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500'}>
                    {tgConnected ? 'Online' : 'Offline'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Config Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.06 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <Send className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Configurar Bot de Telegram</CardTitle>
                    <CardDescription>Conecta tu bot para chat automático con IA</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {tgConnected ? (
                  <div className="text-center py-4">
                    <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <CheckCircle className="w-8 h-8 text-emerald-600" />
                    </div>
                    <p className="text-sm text-emerald-700 mb-1">Bot {tgBotUsername ? `@${tgBotUsername}` : ''} conectado</p>
                    <p className="text-xs text-slate-400 mb-4">Los mensajes entrantes reciben respuesta automática del agente IA</p>
                    <div className="flex items-center justify-center gap-3 mb-4">
                      <span className="text-sm text-slate-600">Auto-respuesta IA:</span>
                      <button
                        onClick={async () => {
                          setTgAutoReply(!tgAutoReply)
                          try { await api.saveTelegramConfig({ botToken: '_keep', autoReply: !tgAutoReply }) } catch {}
                        }}
                        className="flex items-center"
                      >
                        {tgAutoReply ? <ToggleRight className="w-8 h-8 text-emerald-600" /> : <ToggleLeft className="w-8 h-8 text-slate-400" />}
                      </button>
                    </div>
                    <Button variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 gap-2" onClick={handleTelegramDisconnect} disabled={tgLoading}>
                      <Unplug className="w-4 h-4" /> Desconectar Telegram
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Key className="w-4 h-4 text-slate-500" /> Bot Token
                      </Label>
                      <Input
                        type="password"
                        value={tgBotToken}
                        onChange={(e) => setTgBotToken(e.target.value)}
                        placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-slate-400">Obtenlo desde @BotFather en Telegram</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-slate-600">Auto-respuesta IA:</span>
                      <button onClick={() => setTgAutoReply(!tgAutoReply)} className="flex items-center">
                        {tgAutoReply ? <ToggleRight className="w-8 h-8 text-emerald-600" /> : <ToggleLeft className="w-8 h-8 text-slate-400" />}
                      </button>
                    </div>
                    <Button
                      onClick={handleTelegramConnect}
                      disabled={tgLoading || !tgBotToken.trim()}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/25 gap-2 w-full"
                    >
                      {tgLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                      Verificar y Conectar
                    </Button>
                  </>
                )}

                <Separator />
                <div className="space-y-2.5">
                  <h4 className="text-sm font-semibold text-slate-700">Cómo conectar:</h4>
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                    <p className="text-sm text-slate-600">Abre Telegram y busca <strong>@BotFather</strong></p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                    <p className="text-sm text-slate-600">Envía <strong>/newbot</strong> y sigue las instrucciones</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                    <p className="text-sm text-slate-600">Copia el <strong>Bot Token</strong> y pégalo arriba</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                    <p className="text-sm text-slate-600">Haz clic en <strong>"Verificar y Conectar"</strong></p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Features Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.12 }}>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-5">
                <h4 className="font-semibold text-sm text-slate-900 mb-3">Capacidades de Telegram Agentic</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-emerald-50 rounded-xl p-3">
                    <Send className="w-5 h-5 text-emerald-600 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Auto-respuesta IA</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">El agente responde mensajes 24/7</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3">
                    <Zap className="w-5 h-5 text-amber-500 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Creación de contactos</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Crea clientes automáticamente desde chats</p>
                  </div>
                  <div className="bg-violet-50 rounded-xl p-3">
                    <RefreshCw className="w-5 h-5 text-violet-500 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Historial integrado</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Conversaciones vinculadas al CRM</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ============ TAB: Google ============ */}
        <TabsContent value="google" className="space-y-6 mt-4">
          {/* Status Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className={`border-0 shadow-sm ${googleConnected ? 'bg-emerald-50/50' : 'bg-slate-50/50'}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${googleConnected ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    {googleConnected ? <CheckCircle className="w-6 h-6 text-emerald-600" /> : <Cloud className="w-6 h-6 text-slate-400" />}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold ${googleConnected ? 'text-emerald-900' : 'text-slate-700'}`}>
                      {googleConnected ? 'Google Workspace Conectado' : 'Google Workspace Sin Conectar'}
                    </h3>
                    <p className={`text-sm mt-1 ${googleConnected ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {googleConnected
                        ? 'Tu cuenta de Google está vinculada. Puedes usar Gmail, Calendar y Sheets.'
                        : 'Conecta tu cuenta de Google para habilitar Gmail, Calendar y sincronización de Sheets.'}
                    </p>
                    {googleScopes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {googleScopes.some(s => s.includes('gmail')) && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700">Gmail</Badge>}
                        {googleScopes.some(s => s.includes('calendar')) && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700">Calendar</Badge>}
                        {googleScopes.some(s => s.includes('sheets')) && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700">Sheets</Badge>}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className={googleConnected ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500'}>
                    {googleConnected ? 'Conectado' : 'Desconectado'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Config Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.06 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <Cloud className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Google Workspace</CardTitle>
                    <CardDescription>Gmail, Calendar y Sheets integrados con tu CRM</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {googleConnected ? (
                  <div className="text-center py-4">
                    <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <CheckCircle className="w-8 h-8 text-emerald-600" />
                    </div>
                    <p className="text-sm text-emerald-700 mb-4">Cuenta de Google vinculada correctamente</p>
                    <Button variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 gap-2" onClick={handleGoogleDisconnect} disabled={googleLoading}>
                      <Unplug className="w-4 h-4" /> Desconectar Google
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Key className="w-4 h-4 text-slate-500" /> Client ID
                      </Label>
                      <Input
                        value={googleClientId}
                        onChange={(e) => setGoogleClientId(e.target.value)}
                        placeholder="xxxx.apps.googleusercontent.com"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Key className="w-4 h-4 text-slate-500" /> Client Secret
                      </Label>
                      <Input
                        type="password"
                        value={googleClientSecret}
                        onChange={(e) => setGoogleClientSecret(e.target.value)}
                        placeholder="GOCSPX-xxxx"
                        className="font-mono text-sm"
                      />
                    </div>
                    <Button
                      onClick={handleGoogleSaveAndConnect}
                      disabled={googleLoading || !googleClientId.trim() || !googleClientSecret.trim()}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/25 gap-2 w-full"
                    >
                      {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                      Conectar Cuenta de Google
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Features Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.12 }}>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-5">
                <h4 className="font-semibold text-sm text-slate-900 mb-3">Funciones de Google Workspace</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-emerald-50 rounded-xl p-3">
                    <Mail className="w-5 h-5 text-emerald-600 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Gmail</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Envía emails desde el CRM</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3">
                    <Calendar className="w-5 h-5 text-amber-500 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Calendar</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Crea y consulta eventos</p>
                  </div>
                  <div className="bg-violet-50 rounded-xl p-3">
                    <Table className="w-5 h-5 text-violet-500 mb-1.5" />
                    <p className="text-xs font-semibold text-slate-700">Sheets</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Sincroniza inventario desde hojas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ============ TAB: Inventario Nube ============ */}
        <TabsContent value="inventario" className="space-y-6 mt-4">
          {/* Status Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className={`border-0 shadow-sm ${invActive ? 'bg-emerald-50/50' : 'bg-slate-50/50'}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${invActive ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    {invActive ? <CheckCircle className="w-6 h-6 text-emerald-600" /> : <Database className="w-6 h-6 text-slate-400" />}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold ${invActive ? 'text-emerald-900' : 'text-slate-700'}`}>
                      {invActive ? 'Sincronización Activa' : 'Inventario Nube Sin Configurar'}
                    </h3>
                    <p className={`text-sm mt-1 ${invActive ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {invActive
                        ? `Sincronizando desde Google Sheets cada ${invSyncInterval} minutos.`
                        : 'Configura la sincronización de inventario desde una hoja de Google Sheets.'}
                    </p>
                    {invLastSync && (
                      <p className="text-xs text-slate-400 mt-1">
                        <Clock className="w-3 h-3 inline mr-1" />
                        Última sync: {new Date(invLastSync).toLocaleString('es')}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className={invActive ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500'}>
                    {invActive ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
                {invLastResult && (
                  <div className="mt-3 pt-3 border-t border-slate-200/50 grid grid-cols-4 gap-2 text-center">
                    <div><p className="text-lg font-bold text-emerald-600">{invLastResult.created ?? 0}</p><p className="text-[10px] text-slate-500">Creados</p></div>
                    <div><p className="text-lg font-bold text-amber-600">{invLastResult.updated ?? 0}</p><p className="text-[10px] text-slate-500">Actualizados</p></div>
                    <div><p className="text-lg font-bold text-slate-500">{invLastResult.skipped ?? 0}</p><p className="text-[10px] text-slate-500">Omitidos</p></div>
                    <div><p className="text-lg font-bold text-red-500">{invLastResult.errors ?? 0}</p><p className="text-[10px] text-slate-500">Errores</p></div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Config Card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.06 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <ArrowRightLeft className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Sincronización de Inventario</CardTitle>
                    <CardDescription>Importa productos desde Google Sheets al catálogo</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {!googleConnected && (
                  <div className="bg-amber-50 rounded-xl p-4 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    <p className="text-sm text-amber-800">Primero conecta tu cuenta de Google en la pestaña "Google"</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Spreadsheet ID</Label>
                  <Input
                    value={invSpreadsheetId}
                    onChange={(e) => setInvSpreadsheetId(e.target.value)}
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-slate-400">Se extrae de la URL: docs.google.com/spreadsheets/d/<strong>ESTE_ID</strong>/edit</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Nombre de la Hoja</Label>
                    <Input
                      value={invSheetName}
                      onChange={(e) => setInvSheetName(e.target.value)}
                      placeholder="Inventario"
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Rango</Label>
                    <Input
                      value={invRange}
                      onChange={(e) => setInvRange(e.target.value)}
                      placeholder="A1:Z1000"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>

                <Separator />

                <div>
                  <Label className="text-sm font-medium mb-3 block">Mapeo de Columnas</Label>
                  <p className="text-xs text-slate-400 mb-3">Indica qué columna (0=A, 1=B, etc.) corresponde a cada campo</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Nombre</Label>
                      <Input type="number" min={0} value={invColumnMap.name} onChange={(e) => setInvColumnMap({ ...invColumnMap, name: parseInt(e.target.value) || 0 })} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Descripción</Label>
                      <Input type="number" min={0} value={invColumnMap.description} onChange={(e) => setInvColumnMap({ ...invColumnMap, description: parseInt(e.target.value) || 0 })} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Categoría</Label>
                      <Input type="number" min={0} value={invColumnMap.category} onChange={(e) => setInvColumnMap({ ...invColumnMap, category: parseInt(e.target.value) || 0 })} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Precio</Label>
                      <Input type="number" min={0} value={invColumnMap.price} onChange={(e) => setInvColumnMap({ ...invColumnMap, price: parseInt(e.target.value) || 0 })} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Duración (min)</Label>
                      <Input type="number" min={0} value={invColumnMap.duration} onChange={(e) => setInvColumnMap({ ...invColumnMap, duration: parseInt(e.target.value) || 0 })} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Intervalo (min)</Label>
                      <Select value={String(invSyncInterval)} onValueChange={(v) => setInvSyncInterval(parseInt(v))}>
                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15">15 min</SelectItem>
                          <SelectItem value="30">30 min</SelectItem>
                          <SelectItem value="60">1 hora</SelectItem>
                          <SelectItem value="360">6 horas</SelectItem>
                          <SelectItem value="1440">24 horas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">Auto-sync:</span>
                  <button onClick={() => setInvActive(!invActive)} className="flex items-center">
                    {invActive ? <ToggleRight className="w-8 h-8 text-emerald-600" /> : <ToggleLeft className="w-8 h-8 text-slate-400" />}
                  </button>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleInventorySave}
                    disabled={invLoading || !invSpreadsheetId.trim()}
                    variant="outline"
                    className="gap-2 flex-1"
                  >
                    {invLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Guardar Config
                  </Button>
                  <Button
                    onClick={handleInventorySync}
                    disabled={invLoading || !googleConnected || !invSpreadsheetId.trim()}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-500/25 gap-2 flex-1"
                  >
                    {invLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Sincronizar Ahora
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ============ TAB: Plantillas ============ */}
        <TabsContent value="plantillas" className="space-y-6 mt-4">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <Mail className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Plantillas de Mensajes</CardTitle>
                    <CardDescription>Crea plantillas reutilizables para WhatsApp, Telegram y Email</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <TemplatesTab />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ============ TAB: Campos Custom ============ */}
        <TabsContent value="custom-fields" className="space-y-6 mt-4">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <Database className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Campos Personalizados</CardTitle>
                    <CardDescription>Agrega campos adicionales a tus clientes y oportunidades</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CustomFieldsTab />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
        {/* ============ TAB: Email SMTP ============ */}
        <TabsContent value="email" className="space-y-6 mt-4">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className={`border-0 shadow-sm ${settings?.email?.configured ? 'bg-emerald-50/50' : 'bg-slate-50/50'}`}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${settings?.email?.configured ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                    <Mail className={`w-6 h-6 ${settings?.email?.configured ? 'text-emerald-600' : 'text-slate-400'}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold ${settings?.email?.configured ? 'text-emerald-900' : 'text-slate-700'}`}>
                      {settings?.email?.configured ? 'Email SMTP Configurado' : 'Email SMTP Sin Configurar'}
                    </h3>
                    <p className={`text-sm mt-1 ${settings?.email?.configured ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {settings?.email?.configured
                        ? `Servidor: ${settings?.email?.host}. Los emails se enviaran correctamente.`
                        : 'Configura tu servidor SMTP para enviar emails desde las plantillas.'}
                    </p>
                  </div>
                  <Badge variant="outline" className={settings?.email?.configured ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500'}>
                    {settings?.email?.configured ? 'Configurado' : 'Sin Config'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.06 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <Mail className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Configuracion SMTP</CardTitle>
                    <CardDescription>Servidor de correo para envio de emails</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Configuracion en .env</span>
                  </div>
                  <p className="text-xs text-amber-700">Las credenciales SMTP se configuran en el archivo <code className="bg-amber-100 px-1 rounded">.env</code> del servidor por seguridad. Variables requeridas:</p>
                  <ul className="text-xs text-amber-700 mt-2 space-y-1 list-disc list-inside">
                    <li><code>SMTP_HOST</code> - Servidor SMTP (ej: smtp.gmail.com)</li>
                    <li><code>SMTP_PORT</code> - Puerto (587 para TLS, 465 para SSL)</li>
                    <li><code>SMTP_USER</code> - Usuario/email</li>
                    <li><code>SMTP_PASS</code> - Contrasena o App Password</li>
                    <li><code>SMTP_FROM_NAME</code> - Nombre del remitente (opcional)</li>
                  </ul>
                </div>

                {settings?.email?.configured && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Servidor Actual</Label>
                    <p className="text-sm text-slate-600 font-mono">{settings?.email?.host}</p>
                    <p className="text-xs text-slate-400">Remitente: {settings?.email?.fromName}</p>
                  </div>
                )}

                <Separator />

                <div className="space-y-3">
                  <Label className="text-sm font-medium">Probar Configuracion</Label>
                  <p className="text-xs text-slate-500">Envia un email de prueba para verificar que el SMTP funciona correctamente.</p>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      value={emailTestAddr}
                      onChange={(e) => setEmailTestAddr(e.target.value)}
                      placeholder="tu@email.com"
                      className="flex-1 text-sm"
                    />
                    <Button
                      onClick={handleTestEmail}
                      disabled={emailTesting}
                      variant="outline"
                      className="gap-1.5"
                    >
                      {emailTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Enviar Test
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ============ TAB: Team ============ */}
        <TabsContent value="team" className="space-y-6 mt-4">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <Users className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">Equipo</CardTitle>
                    <CardDescription>Gestiona los miembros de tu equipo y sus roles</CardDescription>
                  </div>
                  <Button onClick={() => setShowInviteDialog(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Invitar Miembro
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {teamLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                  </div>
                ) : teamMembers.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No hay otros miembros en el equipo</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {teamMembers.map((member: TeamMember) => (
                      <div key={member.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-sm font-bold">
                            {member.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{member.name}</p>
                            <p className="text-xs text-slate-500">{member.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={
                            member.role === 'admin' ? 'border-blue-200 text-blue-700 bg-blue-50' :
                            'border-slate-200 text-slate-600'
                          }>
                            {member.role}
                          </Badge>
                          {!member.isActive && <Badge variant="outline" className="border-red-200 text-red-600 bg-red-50">Inactivo</Badge>}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8"
                            onClick={() => handleDeactivateMember(member.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Role Permissions Info */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.06 }}>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center">
                    <Shield className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Permisos por Rol</CardTitle>
                    <CardDescription>Que puede hacer cada rol en el CRM</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                    <h4 className="text-sm font-semibold text-emerald-900 mb-1">Owner (Propietario)</h4>
                    <p className="text-xs text-emerald-700">Acceso completo. Puede gestionar equipo, configuracion y todos los datos. Solo puede haber un owner.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                    <h4 className="text-sm font-semibold text-blue-900 mb-1">Admin (Administrador)</h4>
                    <p className="text-xs text-blue-700">Puede gestionar clientes, oportunidades, cotizaciones, productos, automatizaciones, plantillas y reportes. Puede crear/editar productos y automatizaciones. No puede gestionar equipo.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <h4 className="text-sm font-semibold text-slate-900 mb-1">Agent (Agente)</h4>
                    <p className="text-xs text-slate-700">Puede ver y crear clientes, oportunidades, cotizaciones y transacciones. Solo lectura en productos y automatizaciones. No puede eliminar clientes ni gestionar configuracion.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ============ TAB: Backup/Restore ============ */}
        <TabsContent value="backup" className="space-y-6 mt-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <Database className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Respaldo y Restauración</CardTitle>
                    <CardDescription>Exporta o importa todos los datos del CRM</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Export */}
                <div className="p-5 rounded-xl bg-emerald-50/50 border border-emerald-100">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Download className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-emerald-900">Exportar Datos</h3>
                      <p className="text-sm text-emerald-700 mt-1">
                        Descarga una copia completa de todos tus datos en formato JSON. Incluye clientes, oportunidades, cotizaciones, transacciones, configuraciones y más.
                      </p>
                      <Button
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem('crm_token')
                            const res = await fetch('/api/backup', {
                              headers: token ? { Authorization: `Bearer ${token}` } : {},
                            })
                            if (!res.ok) throw new Error('Error al exportar')
                            const blob = await res.blob()
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `crm-albra-backup-${new Date().toISOString().split('T')[0]}.json`
                            a.click()
                            URL.revokeObjectURL(url)
                            toast.success('Backup exportado exitosamente')
                          } catch {
                            toast.error('Error al exportar backup')
                          }
                        }}
                        className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <Download className="w-4 h-4 mr-2" /> Exportar Backup JSON
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Import */}
                <div className="p-5 rounded-xl bg-amber-50/50 border border-amber-100">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Upload className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-amber-900">Restaurar Datos</h3>
                      <p className="text-sm text-amber-700 mt-1">
                        Importa un archivo de backup previo. Los datos existentes se mantendrán y los del backup se agregarán o actualizarán. Esta acción no se puede deshacer.
                      </p>
                      <div className="mt-3">
                        <input
                          type="file"
                          accept=".json"
                          id="backup-import"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            if (!confirm('Estás a punto de restaurar un backup. Los datos se fusionarán con los existentes. ¿Continuar?')) {
                              e.target.value = ''
                              return
                            }
                            try {
                              const text = await file.text()
                              const backup = JSON.parse(text)
                              const token = localStorage.getItem('crm_token')
                              const res = await fetch('/api/backup', {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                                },
                                body: JSON.stringify(backup),
                              })
                              const data = await res.json()
                              if (!res.ok) throw new Error(data.error)
                              toast.success(`Backup restaurado: ${data.imported} registros importados, ${data.skipped} omitidos`)
                            } catch (err: any) {
                              toast.error(err.message || 'Error al importar backup')
                            } finally {
                              e.target.value = ''
                            }
                          }}
                        />
                        <Button
                          variant="outline"
                          onClick={() => document.getElementById('backup-import')?.click()}
                          className="border-amber-200 text-amber-700 hover:bg-amber-50"
                        >
                          <Upload className="w-4 h-4 mr-2" /> Seleccionar Archivo JSON
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>

      {/* System Info (always visible) */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.18 }}
      >
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Settings className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Información del Sistema</CardTitle>
                <CardDescription>Estado actual de los servicios</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${isConfigured ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  <span className="text-sm text-slate-700">Proveedor LLM</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {settings?.system.provider ?? 'No configurado'}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm text-slate-700">Chat AI</span>
                </div>
                <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700">
                  Habilitado
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${isWaConnected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="text-sm text-slate-700">WhatsApp</span>
                </div>
                <Badge variant="outline" className={`text-xs ${isWaConnected ? 'border-emerald-200 text-emerald-700' : ''}`}>
                  {isWaConnected ? `Conectado (${waStatus.phone})` : 'Desconectado'}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm text-slate-700">Base de Datos</span>
                </div>
                <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700">
                  SQLite (Local)
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${settings?.llm.apiKeyConfigured ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                  <span className="text-sm text-slate-700">SDK Z-AI (fallback)</span>
                </div>
                <Badge variant="outline" className={`text-xs ${settings?.llm.apiKeyConfigured ? 'border-slate-200 text-slate-500' : 'border-emerald-200 text-emerald-700'}`}>
                  {settings?.llm.apiKeyConfigured ? 'Inactivo (tu API key tiene prioridad)' : 'Activo (usando SDK integrado)'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
