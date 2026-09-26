'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  UserPlus,
  TrendingUp,
  FileText,
  Calendar,
  AlertCircle,
  MessageSquare,
  Zap,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link?: string | null
  isRead: boolean
  createdAt: string
}

const typeIcons: Record<string, React.ReactNode> = {
  lead: <UserPlus className="w-4 h-4" />,
  opportunity: <TrendingUp className="w-4 h-4" />,
  reservation: <Calendar className="w-4 h-4" />,
  system: <AlertCircle className="w-4 h-4" />,
  message: <MessageSquare className="w-4 h-4" />,
  alert: <Zap className="w-4 h-4" />,
}

const typeColors: Record<string, string> = {
  lead: 'bg-emerald-100 text-emerald-600',
  opportunity: 'bg-teal-100 text-teal-600',
  reservation: 'bg-sky-100 text-sky-600',
  system: 'bg-slate-100 text-slate-600',
  message: 'bg-purple-100 text-purple-600',
  alert: 'bg-amber-100 text-amber-600',
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadNotifications = useCallback(async () => {
    try {
      const data = await api.getNotifications()
      setNotifications((data.notifications as Notification[]) || [])
      setUnreadCount((data.unreadCount as number) || 0)
    } catch {
      // Silent fail on poll
    }
  }, [])

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await api.getNotifications()
        setNotifications((data.notifications as Notification[]) || [])
        setUnreadCount((data.unreadCount as number) || 0)
      } catch {
        // Silent fail
      }
    }
    poll()
    pollRef.current = setInterval(poll, 30000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.markNotificationRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {
      toast.error('Error al marcar como leída')
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead()
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
      toast.success('Todas las notificaciones marcadas como leídas')
    } catch {
      toast.error('Error al marcar como leídas')
    }
  }

  const handleDeleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'DELETE',
        // Token en memoria si existe; si no (tras F5), la cookie httpOnly autentica.
        headers: useAppStore.getState().token
          ? { 'Authorization': `Bearer ${useAppStore.getState().token}` }
          : {},
      })
      setNotifications(prev => prev.filter(n => n.id !== id))
      toast.success('Notificación eliminada')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const handleNotificationClick = (n: Notification) => {
    if (!n.isRead) handleMarkAsRead(n.id)
    if (n.link) {
      const [view, id] = n.link.split(':')
      const store = useAppStore.getState()
      if (view === 'clients' && id) {
        store.setSelectedClientId(id)
        store.setView('client-detail')
      } else if (view === 'opportunities') {
        store.setView('opportunities')
      } else if (view === 'quotes') {
        store.setView('quotes')
      } else if (view === 'calendar') {
        store.setView('calendar')
      } else if (view) {
        store.setView(view)
      }
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-slate-500 hover:text-slate-700 hover:bg-slate-100">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 shadow-xl border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50/50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Notificaciones</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
                {unreadCount} nueva{unreadCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllRead}
                className="h-6 text-[11px] text-emerald-600 hover:text-emerald-700 px-2 hover:bg-emerald-50"
                title="Marcar todas como leídas"
              >
                <CheckCheck className="w-3 h-3 mr-1" /> Leer todo
              </Button>
            )}
          </div>
        </div>

        {/* Notification List */}
        <ScrollArea className="max-h-96">
          {notifications.length === 0 ? (
            <div className="py-10 text-center">
              <Bell className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-400">No hay notificaciones</p>
              <p className="text-xs text-slate-300 mt-1">Te notificaremos cuando haya novedades</p>
            </div>
          ) : (
            <div>
              <AnimatePresence>
                {notifications.map((n) => (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`px-4 py-3 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors group relative ${!n.isRead ? 'bg-emerald-50/30' : ''}`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeColors[n.type] || 'bg-slate-100 text-slate-600'}`}>
                        {typeIcons[n.type] || <Bell className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm truncate ${!n.isRead ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                            {n.title}
                          </p>
                          {!n.isRead && (
                            <div className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{n.message}</p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                      {/* Delete button on hover */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500 flex-shrink-0"
                        onClick={(e) => handleDeleteNotification(n.id, e)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="px-4 py-2 border-t bg-slate-50/50 rounded-b-lg">
            <p className="text-[10px] text-slate-400 text-center">
              Actualización automática cada 30 segundos
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
