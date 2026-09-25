'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MessageCircle,
  Search,
  Send,
  Bot,
  User,
  Settings,
  Wifi,
  WifiOff,
  Phone,
  Zap,
  UserCheck,
  Clock,
  Loader2,
  QrCode,
  RefreshCw,
} from 'lucide-react'
import { format, isToday, isYesterday, isThisWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

/* El frontend NUNCA habla directo al daemon (puerto 3002): todo pasa por
 * /api/whatsapp/daemon-proxy con JWT (auditoría Antigravity, críticos #3/#4).
 * Antes el envío manual daba 401 y las conversaciones eran legibles sin login. */

/* ──── Types ──── */
interface Conversation {
  id: string
  userId: string
  contactPhone: string
  contactName: string | null
  lastMessage: string | null
  lastMessageAt: string | null
  lastMessageFrom: string | null
  status: string
  transferredTo: string | null
  unreadCount: number
  isAutoReply: number | boolean
  clientId: string | null
  clientName?: string | null
  clientTemperature?: string | null
  createdAt: string
  updatedAt: string
}

interface WaMessage {
  id: string
  conversationId: string
  direction: string
  fromNumber: string
  toNumber: string
  text: string | null
  messageType: string
  senderType: string
  isRead: number | boolean
  createdAt: string
}

interface WaDaemonStatus {
  status: string
  phone: string | null
  lastUpdate: string | null
}

/* ──── Helpers ──── */
function formatTime(dateStr: string | null) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Ayer'
  if (isThisWeek(d)) return format(d, 'EEE', { locale: es })
  return format(d, 'd/M')
}

export function WhatsAppPage() {
  const { setView, setSelectedClientId } = useAppStore()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<WaMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [daemonStatus, setDaemonStatus] = useState<WaDaemonStatus>({ status: 'disconnected', phone: null, lastUpdate: null })
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.getWhatsAppStatus() as WaDaemonStatus
      setDaemonStatus(data)
    } catch {
      setDaemonStatus({ status: 'daemon_offline', phone: null, lastUpdate: null })
    }
  }, [])

  const loadConversations = useCallback(async () => {
    try {
      const data = await api.getWhatsAppConversations() as { conversations: Conversation[] }
      setConversations(data.conversations ?? [])
    } catch {
      // Daemon may be offline
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    loadConversations()

    // Auto-refresh every 8s
    const timer = setInterval(() => {
      loadStatus()
      loadConversations()
    }, 8000)

    return () => clearInterval(timer)
  }, [loadStatus, loadConversations])

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const selectConversation = async (id: string) => {
    setSelectedId(id)
    setLoadingMessages(true)
    try {
      const data = await api.getWhatsAppConversation(id) as { conversation?: Conversation & { messages: WaMessage[] }; error?: string }
      if (data.error) {
        toast.error(data.error)
      }
      setMessages(data.conversation?.messages ?? [])
      // Mark as read locally
      setConversations(prev => prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c))
    } catch {
      toast.error('Error al cargar mensajes')
    } finally {
      setLoadingMessages(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || !selectedId || sending) return
    setSending(true)
    try {
      const conv = conversations.find(c => c.id === selectedId)
      if (!conv) return

      // Envío vía backend (proxy autenticado): inyecta el secreto server-to-server
      const result = await api.sendWhatsAppMessage({ to: conv.contactPhone, text: input.trim() }) as { success?: boolean; error?: string }
      if (result?.error) {
        toast.error(result.error)
        return
      }

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        conversationId: selectedId,
        direction: 'outbound',
        fromNumber: daemonStatus.phone ?? '',
        toNumber: conv.contactPhone,
        text: input.trim(),
        messageType: 'text',
        senderType: 'human',
        isRead: 1,
        createdAt: new Date().toISOString(),
      }])
      setInput('')
      loadConversations()
    } catch {
      toast.error('Error al enviar mensaje')
    } finally {
      setSending(false)
    }
  }

  const toggleAutoReply = async (conv: Conversation) => {
    try {
      await api.updateWhatsAppConversation(conv.id, { isAutoReply: !conv.isAutoReply })
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, isAutoReply: !c.isAutoReply } : c))
      toast.success(conv.isAutoReply ? 'Agente IA desactivado' : 'Agente IA activado')
    } catch {
      toast.error('Error al cambiar modo')
    }
  }

  const takeOverConversation = async (conv: Conversation) => {
    try {
      await api.updateWhatsAppConversation(conv.id, { status: 'active', isAutoReply: false, transferredTo: null })
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, status: 'active', isAutoReply: false, transferredTo: null } : c))
      toast.success('Conversación retomada')
    } catch {
      toast.error('Error al retomar conversación')
    }
  }

  const isWaConnected = daemonStatus.status === 'connected'
  const isDaemonOffline = daemonStatus.status === 'daemon_offline'

  const filtered = conversations.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (c.contactName ?? '').toLowerCase().includes(q) || c.contactPhone.includes(q)
  })

  const selectedConv = conversations.find(c => c.id === selectedId)

  return (
    <div className="flex h-[calc(100vh-6.5rem)] gap-3">
      {/* Left Panel - Conversation List */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        <Card className="border-0 shadow-sm flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-slate-900">WhatsApp</h2>
                {isWaConnected ? (
                  <Badge className="text-[9px] h-4 px-1.5 bg-emerald-50 text-emerald-700 border-0">
                    <Wifi className="w-2.5 h-2.5 mr-0.5" /> Online
                  </Badge>
                ) : (
                  <Badge className="text-[9px] h-4 px-1.5 bg-slate-100 text-slate-500 border-0">
                    <WifiOff className="w-2.5 h-2.5 mr-0.5" /> Off
                  </Badge>
                )}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                // Navigate to settings -> whatsapp tab
                setView('settings')
              }}>
                <Settings className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-7 text-xs" />
            </div>
          </div>

          {/* Conversations */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 mx-2 mt-2 rounded-lg" />)
            ) : isDaemonOffline ? (
              <div className="p-6 text-center">
                <WifiOff className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Daemon de WhatsApp no disponible</p>
                <p className="text-[10px] text-slate-300 mt-1">Verifica que el servicio esté corriendo en el puerto 3002</p>
              </div>
            ) : !isWaConnected ? (
              <div className="p-6 text-center">
                <QrCode className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400 mb-2">WhatsApp no conectado</p>
                <Button size="sm" className="mt-1 bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs gap-1" onClick={() => setView('settings')}>
                  <QrCode className="w-3 h-3" /> Conectar por QR
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center">
                <MessageCircle className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Sin conversaciones aún</p>
                <p className="text-[10px] text-slate-300 mt-1">Los mensajes entrantes aparecerán aquí</p>
              </div>
            ) : (
              filtered.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                    selectedId === conv.id ? 'bg-emerald-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {(conv.contactName ?? conv.contactPhone).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-slate-900 truncate">
                          {conv.contactName ?? conv.contactPhone}
                        </span>
                        <span className="text-[10px] text-slate-400 flex-shrink-0 ml-1">
                          {formatTime(conv.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[11px] text-slate-500 truncate pr-2">
                          {conv.lastMessageFrom === 'agent' && <Bot className="w-2.5 h-2.5 inline mr-0.5 text-emerald-500" />}
                          {conv.lastMessageFrom === 'human' && <User className="w-2.5 h-2.5 inline mr-0.5 text-blue-500" />}
                          {conv.lastMessage ?? 'Sin mensajes'}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {conv.status === 'transferred' && (
                            <UserCheck className="w-3 h-3 text-amber-500" />
                          )}
                          {conv.isAutoReply && conv.status === 'active' && (
                            <Zap className="w-3 h-3 text-emerald-500" />
                          )}
                          {conv.unreadCount > 0 && (
                            <span className="w-4 h-4 bg-emerald-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Right Panel - Chat View */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedConv ? (
          <Card className="border-0 shadow-sm flex-1 flex flex-col overflow-hidden">
            {/* Chat Header */}
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">
                  {(selectedConv.contactName ?? selectedConv.contactPhone).charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedConv.contactName ?? selectedConv.contactPhone}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span className="text-[11px] text-slate-500">{selectedConv.contactPhone}</span>
                    {selectedConv.clientId && selectedConv.clientTemperature && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 cursor-pointer" onClick={() => { setSelectedClientId(selectedConv.clientId!); setView('client-detail') }}>
                        {selectedConv.clientTemperature}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {selectedConv.status === 'transferred' ? (
                  <Button size="sm" className="h-7 text-[11px] bg-amber-500 hover:bg-amber-600 text-white gap-1" onClick={() => takeOverConversation(selectedConv)}>
                    <UserCheck className="w-3 h-3" /> Retomar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={selectedConv.isAutoReply ? 'default' : 'outline'}
                    className={`h-7 text-[11px] gap-1 ${selectedConv.isAutoReply ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
                    onClick={() => toggleAutoReply(selectedConv)}
                  >
                    {selectedConv.isAutoReply ? <><Bot className="w-3 h-3" /> IA Activa</> : <><User className="w-3 h-3" /> Manual</>}
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/50">
              {loadingMessages ? (
                [...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg max-w-[60%]" />)
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <MessageCircle className="w-10 h-10 text-slate-200 mb-2" />
                  <p className="text-xs text-slate-400">No hay mensajes en esta conversación</p>
                </div>
              ) : (
                messages.map(msg => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`flex ${msg.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 ${
                      msg.direction === 'inbound'
                        ? 'bg-white text-slate-900 rounded-bl-sm shadow-sm'
                        : msg.senderType === 'agent'
                          ? 'bg-emerald-600 text-white rounded-br-sm'
                          : 'bg-blue-600 text-white rounded-br-sm'
                    }`}>
                      {msg.direction === 'outbound' && (
                        <div className="flex items-center gap-1 mb-0.5">
                          {msg.senderType === 'agent' ? (
                            <Bot className="w-2.5 h-2.5 opacity-70" />
                          ) : (
                            <User className="w-2.5 h-2.5 opacity-70" />
                          )}
                          <span className="text-[9px] opacity-70">
                            {msg.senderType === 'agent' ? 'IA' : 'Tú'}
                          </span>
                        </div>
                      )}
                      <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      <p className={`text-[9px] mt-0.5 ${msg.direction === 'inbound' ? 'text-slate-400' : 'opacity-60'}`}>
                        {format(new Date(msg.createdAt), 'HH:mm', { locale: es })}
                      </p>
                    </div>
                  </motion.div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-100 p-3 flex-shrink-0">
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  placeholder={isWaConnected ? "Escribe un mensaje..." : "WhatsApp no conectado"}
                  disabled={sending || !isWaConnected}
                  className="flex-1 h-9 text-sm"
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || sending || !isWaConnected}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 w-9 p-0"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm flex-1 flex items-center justify-center">
            <div className="text-center p-8">
              <div className="w-20 h-20 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-10 h-10 text-emerald-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-2">WhatsApp Agentic</h3>
              <p className="text-sm text-slate-400 max-w-sm mx-auto mb-4">
                Conecta tu WhatsApp por QR para que el agente IA responda automáticamente, haga seguimiento y transfiera a humanos cuando sea necesario.
              </p>
              <div className="flex flex-col gap-2 items-center">
                {!isWaConnected && (
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2" onClick={() => setView('settings')}>
                    <QrCode className="w-4 h-4" /> Conectar por QR
                  </Button>
                )}
                {isWaConnected && (
                  <p className="text-xs text-slate-400">Selecciona una conversación para ver los mensajes</p>
                )}
              </div>

              {/* Feature cards */}
              <div className="grid grid-cols-3 gap-3 mt-6 text-left">
                <div className="bg-white rounded-xl p-3 border border-slate-100">
                  <Bot className="w-5 h-5 text-emerald-600 mb-1.5" />
                  <p className="text-[11px] font-semibold text-slate-700">Auto-respuesta IA</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">El agente responde y califica prospectos 24/7</p>
                </div>
                <div className="bg-white rounded-xl p-3 border border-slate-100">
                  <UserCheck className="w-5 h-5 text-amber-500 mb-1.5" />
                  <p className="text-[11px] font-semibold text-slate-700">Transferencia humana</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Pasa a un humano cuando el agente no pueda</p>
                </div>
                <div className="bg-white rounded-xl p-3 border border-slate-100">
                  <Clock className="w-5 h-5 text-blue-500 mb-1.5" />
                  <p className="text-[11px] font-semibold text-slate-700">Seguimiento auto</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Follow-up programado hasta cerrar la venta</p>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
