'use client'

import { useEffect, useState, useRef } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Send, Bot, User, Sparkles, Loader2, Settings, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export function ChatPage() {
  const { setView } = useAppStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [sending, setSending] = useState(false)
  const [loadingClients, setLoadingClients] = useState(true)
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null)
  const [provider, setProvider] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadClients()
    loadSettingsStatus()
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const loadClients = async () => {
    try {
      const data = await api.getClients({ limit: '50' })
      setClients((data.clients as Array<{ id: string; name: string }>) ?? [])
    } catch {
      // silently fail
    } finally {
      setLoadingClients(false)
    }
  }

  const loadSettingsStatus = async () => {
    try {
      const data = await api.getSettings() as { llm: { apiKeyConfigured: boolean }; system: { provider: string } }
      setApiKeyConfigured(data.llm.apiKeyConfigured)
      setProvider(data.system.provider)
    } catch {
      // Default to using SDK
      setApiKeyConfigured(false)
      setProvider('SDK Z-AI')
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSend = async () => {
    if (!input.trim() || sending) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setSending(true)

    try {
      const data = await api.sendChatMessage({
        message: userMessage.content,
        clientId: selectedClientId || undefined,
      })

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Lo siento, hubo un error al procesar tu mensaje. Verifica que tu API Key esté configurada correctamente en Configuración.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Chat AI</h1>
          <p className="text-sm text-slate-500 mt-1">Tu asistente comercial inteligente</p>
        </div>
        <div className="flex items-center gap-3">
          {/* API Status Badge */}
          {apiKeyConfigured !== null && (
            <Badge
              variant="outline"
              className={`text-xs cursor-pointer ${
                apiKeyConfigured
                  ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                  : 'border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100'
              }`}
              onClick={() => setView('settings')}
            >
              {apiKeyConfigured ? (
                <>
                  <Sparkles className="w-3 h-3 mr-1" />
                  {provider}
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Configurar API
                </>
              )}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setView('settings')}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            title="Configuración de API"
          >
            <Settings className="w-5 h-5" />
          </Button>
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Contexto: Sin cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin cliente</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-0 shadow-sm flex-1 flex flex-col h-[calc(100%-5rem)]">
        {/* Messages Area */}
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">¡Hola! Soy tu asistente IA</h3>
              <p className="text-sm text-slate-500 max-w-md">
                Puedo ayudarte a gestionar clientes, crear oportunidades, revisar tu pipeline y más. ¿En qué te puedo ayudar?
              </p>
              {apiKeyConfigured === false && (
                <button
                  onClick={() => setView('settings')}
                  className="mt-4 flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm hover:bg-amber-100 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Configura tu API Key para habilitar el chat
                </button>
              )}
              <div className="flex flex-wrap gap-2 mt-6">
                {[
                  '¿Cuáles son mis clientes más activos?',
                  'Muéstrame oportunidades en oferta',
                  '¿Quién necesita seguimiento hoy?',
                  'Resumen de ingresos del mes',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="px-3 py-1.5 text-xs bg-emerald-50 text-emerald-700 rounded-full hover:bg-emerald-100 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white rounded-br-md'
                      : 'bg-slate-100 text-slate-900 rounded-bl-md'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  <p className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-emerald-200' : 'text-slate-400'}`}>
                    {format(msg.timestamp, 'HH:mm', { locale: es })}
                  </p>
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {sending && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        {/* Input Area */}
        <div className="border-t border-slate-100 p-4">
          {selectedClientId && (
            <Badge variant="outline" className="mb-2 text-xs">
              Contexto: {clients.find((c) => c.id === selectedClientId)?.name ?? 'Cliente'}
            </Badge>
          )}
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe tu mensaje..."
              disabled={sending}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
