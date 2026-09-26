'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox as InboxIcon, MessageCircle, Send as SendIcon, Instagram, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { InboxConversation, InboxMessage } from '@/lib/inbox'

/**
 * Bandeja omnicanal (Fase 4): WhatsApp + Telegram + Instagram en una sola vista.
 * Dos paneles (lista + hilo) en desktop; en móvil se alterna lista/hilo.
 * Polling cada 12s; envío por el canal de cada conversación vía /api/inbox/send.
 */

const CHANNEL_ICON = {
  whatsapp: MessageCircle,
  telegram: SendIcon,
  instagram: Instagram,
} as const

const CHANNEL_BADGE = {
  whatsapp: 'bg-emerald-100 text-emerald-700',
  telegram: 'bg-sky-100 text-sky-700',
  instagram: 'bg-pink-100 text-pink-700',
} as const

type ChannelFilter = 'all' | InboxConversation['channel']

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d} d` : new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

export function InboxPage() {
  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [selected, setSelected] = useState<InboxConversation | null>(null)
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<ChannelFilter>('all')
  const threadRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true)
    try {
      const res = (await api.getInbox()) as { conversations?: InboxConversation[] }
      setConversations(res.conversations || [])
    } catch {
      if (!silent) toast.error('No se pudo cargar la bandeja')
    } finally {
      setLoadingList(false)
    }
  }, [])

  const openConversation = useCallback(async (conv: InboxConversation) => {
    setSelected(conv)
    setDraft('')
    setLoadingThread(true)
    try {
      const res = (await api.getInboxMessages(conv.key)) as { messages?: InboxMessage[] }
      setMessages(res.messages || [])
      // Abierta → ya no está "sin leer" en la lista local
      setConversations((prev) => prev.map((c) => (c.key === conv.key ? { ...c, unreadCount: 0 } : c)))
    } catch {
      toast.error('No se pudo cargar la conversación')
    } finally {
      setLoadingThread(false)
    }
  }, [])

  // Carga inicial + polling
  useEffect(() => {
    loadList()
    const t = setInterval(() => loadList(true), 12000)
    return () => clearInterval(t)
  }, [loadList])

  // Poll del hilo abierto (solo si no se está enviando)
  useEffect(() => {
    if (!selected) return
    const t = setInterval(async () => {
      if (sending) return
      try {
        const res = (await api.getInboxMessages(selected.key)) as { messages?: InboxMessage[] }
        setMessages(res.messages || [])
      } catch {
        /* silencioso */
      }
    }, 12000)
    return () => clearInterval(t)
  }, [selected, sending])

  // Auto-scroll al último mensaje
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const filtered = useMemo(
    () => (filter === 'all' ? conversations : conversations.filter((c) => c.channel === filter)),
    [conversations, filter]
  )

  const totalUnread = useMemo(() => conversations.reduce((acc, c) => acc + c.unreadCount, 0), [conversations])

  async function handleSend() {
    if (!selected || !draft.trim() || sending) return
    setSending(true)
    const optimistic: InboxMessage = {
      id: `tmp-${Date.now()}`,
      direction: 'out',
      senderType: 'user',
      text: draft.trim(),
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    const text = draft.trim()
    setDraft('')
    try {
      await api.sendInboxMessage({
        key: selected.key,
        contactHandle: selected.contactHandle,
        clientId: selected.clientId,
        text,
      })
      // Refresca el hilo real (el servidor registra el mensaje en su fuente)
      const res = (await api.getInboxMessages(selected.key)) as { messages?: InboxMessage[] }
      setMessages(res.messages || [])
      setConversations((prev) =>
        prev.map((c) => (c.key === selected.key ? { ...c, lastMessage: text, lastMessageAt: optimistic.createdAt, lastMessageFrom: 'out' } : c))
      )
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setDraft(text)
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar el mensaje')
    } finally {
      setSending(false)
    }
  }

  const filters: Array<{ id: ChannelFilter; label: string }> = [
    { id: 'all', label: 'Todas' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'telegram', label: 'Telegram' },
    { id: 'instagram', label: 'Instagram' },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-slate-100">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bandeja</h1>
          <p className="text-xs text-slate-500">
            WhatsApp · Telegram · Instagram {totalUnread > 0 ? `— ${totalUnread} sin leer` : '— todo al día'}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-slate-500 h-8 w-8 p-0" onClick={() => loadList()} title="Actualizar">
          {loadingList ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </div>

      <div className="flex-1 min-h-0 grid md:grid-cols-[340px_1fr]">
        {/* Lista de conversaciones */}
        <div className={cn('border-r border-slate-100 flex flex-col min-h-0', selected && 'hidden md:flex')}>
          <div className="flex gap-1.5 p-3 border-b border-slate-50 flex-wrap">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                  filter === f.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {loadingList ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 text-slate-300 mx-auto animate-spin" />
                <p className="text-xs text-slate-400 mt-2">Cargando conversaciones…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center">
                <InboxIcon className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Sin conversaciones aún</p>
                <p className="text-[10px] text-slate-300 mt-1">Los mensajes de WhatsApp, Telegram e Instagram aparecerán aquí</p>
              </div>
            ) : (
              filtered.map((conv) => {
                const Icon = CHANNEL_ICON[conv.channel]
                return (
                  <button
                    key={conv.key}
                    onClick={() => openConversation(conv)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition-colors',
                      selected?.key === conv.key && 'bg-emerald-50/60'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold">
                          {conv.contactName.slice(0, 2).toUpperCase()}
                        </div>
                        <span className={cn('absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center', CHANNEL_BADGE[conv.channel])}>
                          <Icon className="w-2.5 h-2.5" />
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-medium text-slate-900 truncate">{conv.contactName}</span>
                          <span className="text-[10px] text-slate-400 flex-shrink-0 ml-1">{timeAgo(conv.lastMessageAt)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className={cn('text-xs truncate', conv.lastMessageFrom === 'in' ? 'text-slate-600' : 'text-slate-400')}>
                            {conv.lastMessageFrom === 'out' && 'Tú: '}
                            {conv.lastMessage || 'Sin mensajes'}
                          </span>
                          {conv.unreadCount > 0 && (
                            <span className="ml-1 flex-shrink-0 w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center">
                              {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Hilo de conversación */}
        <div className={cn('flex flex-col min-h-0 bg-slate-50/40', !selected && 'hidden md:flex')}>
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center px-6">
                <InboxIcon className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-500">Selecciona una conversación</p>
                <p className="text-xs text-slate-400 mt-1">Responde a tus clientes desde un solo lugar, sin importar el canal</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 bg-white">
                <Button variant="ghost" size="sm" className="md:hidden h-7 w-7 p-0 text-slate-500" onClick={() => setSelected(null)}>
                  ←
                </Button>
                <span className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0', CHANNEL_BADGE[selected.channel])}>
                  {(() => {
                    const Icon = CHANNEL_ICON[selected.channel]
                    return <Icon className="w-3.5 h-3.5" />
                  })()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">{selected.contactName}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    vía {selected.channelLabel} · {selected.contactHandle || 'sin handle'}
                  </p>
                </div>
                {selected.isAutoReply && (
                  <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">Agente IA activo</span>
                )}
              </div>

              <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 min-h-0">
                {loadingThread ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 mt-8">Sin mensajes en esta conversación</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[75%] px-3 py-2 rounded-2xl text-[13px] leading-snug whitespace-pre-wrap break-words',
                          m.direction === 'out'
                            ? m.senderType === 'agent'
                              ? 'bg-amber-100 text-amber-900 rounded-br-sm'
                              : 'bg-emerald-600 text-white rounded-br-sm'
                            : 'bg-white text-slate-800 border border-slate-100 rounded-bl-sm'
                        )}
                      >
                        {m.text}
                        <span className={cn('block text-[9px] mt-1', m.direction === 'out' ? (m.senderType === 'agent' ? 'text-amber-600' : 'text-emerald-200') : 'text-slate-400')}>
                          {m.senderType === 'agent' ? 'Agente IA · ' : ''}
                          {new Date(m.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 border-t border-slate-100 bg-white">
                <div className="flex gap-2 items-end">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder={`Responder por ${selected.channelLabel}…`}
                    className="min-h-[42px] max-h-32 resize-none text-[13px]"
                    rows={1}
                  />
                  <Button onClick={handleSend} disabled={sending || !draft.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white h-[42px] px-4 gap-1.5">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />}
                    <span className="hidden sm:inline">Enviar</span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
