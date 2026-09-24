'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Bell,
  Check,
  Trash2,
  X,
  UserPlus,
  TrendingUp,
  FileText,
  Calendar,
  AlertCircle,
  MessageSquare,
  Zap,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { motion, AnimatePresence } from 'framer-motion'

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

export function NotificationDropdown() {
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
      // Silent fail
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
      for (const n of notifications.filter(n => !n.isRead)) {
        await api.markNotificationRead(n.id)
      }
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch {
      // Silent
    }
  }

  const handleClearAll = async () => {
    try {
      await api.clearNotifications()
      setNotifications([])
      setUnreadCount(0)
    } catch {
      // Silent
    }
  }

  const handleNotificationClick = async (n: Notification) => {
    if (!n.isRead) handleMarkAsRead(n.id)
    if (n.link) {
      const [view, id] = n.link.split(':')
      const { useAppStore } = await import('@/lib/store')
      const { setView, setSelectedClientId } = useAppStore.getState()
      if (view === 'clients' && id) {
        setSelectedClientId(id)
        setView('client-detail')
      } else if (view) {
        setView(view)
      }
    }
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-slate-500 hover:text-slate-700 hover:bg-slate-100">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-slate-900">Notificaciones</h3>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="h-6 text-[11px] text-emerald-600 hover:text-emerald-700 px-2">
                <Check className="w-3 h-3 mr-1" /> Leer todo
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-6 text-[11px] text-red-500 hover:text-red-600 px-2">
                <Trash2 className="w-3 h-3 mr-1" /> Limpiar
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-96">
          {notifications.length === 0 ? (
            <div className="py-8 text-center">
              <Bell className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No hay notificaciones</p>
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
                    className={`px-4 py-3 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${!n.isRead ? 'bg-emerald-50/30' : ''}`}
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
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Need toast import for the handlers
import { toast } from 'sonner'
