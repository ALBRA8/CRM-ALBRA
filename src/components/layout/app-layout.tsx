'use client'

import { useAppStore } from '@/lib/store'
import { Sidebar, MobileSidebar } from './sidebar'
import { Menu, ChevronRight, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { ThemeToggle } from './theme-toggle'
import { GlobalSearch } from './global-search'

const viewTitles: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Resumen general de tu negocio' },
  clients: { title: 'Clientes', subtitle: 'Gestiona tu cartera de clientes' },
  'client-detail': { title: 'Detalle del Cliente', subtitle: 'Información detallada del cliente' },
  opportunities: { title: 'Oportunidades', subtitle: 'Pipeline de ventas' },
  products: { title: 'Productos', subtitle: 'Catálogo de productos y servicios' },
  whatsapp: { title: 'WhatsApp', subtitle: 'Bandeja de mensajes y agente IA' },
  calendar: { title: 'Calendario', subtitle: 'Gestiona tus reservas y citas' },
  quotes: { title: 'Cotizaciones', subtitle: 'Administra tus cotizaciones' },
  'quote-detail': { title: 'Detalle de Cotización', subtitle: 'Información de la cotización' },
  automations: { title: 'Automatizaciones', subtitle: 'Automatiza tus procesos' },
  chat: { title: 'Chat AI', subtitle: 'Asistente inteligente' },
  finances: { title: 'Finanzas', subtitle: 'Control financiero' },
  reports: { title: 'Reportes', subtitle: 'Análisis de tu negocio' },
  team: { title: 'Equipo', subtitle: 'Gestiona miembros y permisos' },
  activity: { title: 'Actividad', subtitle: 'Registro de acciones del sistema' },
  settings: { title: 'Configuración', subtitle: 'Configura APIs y servicios' },
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, view, user } = useAppStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(true)

  // Track window size for responsive sidebar
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768)
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  const currentView = viewTitles[view] ?? { title: 'CRM ALBRA', subtitle: '' }
  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? 'U'

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop Sidebar */}
      {isDesktop && (
        <div className="fixed left-0 top-0 h-screen z-30 transition-all duration-200 ease-in-out"
          style={{ width: sidebarCollapsed ? 60 : 220 }}
        >
          <Sidebar />
        </div>
      )}

      {/* Mobile Sidebar */}
      {!isDesktop && (
        <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      )}

      {/* Main Content */}
      <main
        className="flex-1 min-w-0 min-h-screen transition-all duration-200 ease-in-out"
        style={{ marginLeft: isDesktop ? (sidebarCollapsed ? 60 : 220) : 0 }}
      >
        {/* Mobile Top Bar */}
        {!isDesktop && (
          <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-4 h-14">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileMenuOpen(true)}
                  className="h-9 w-9 text-slate-600"
                >
                  <Menu className="w-5 h-5" />
                </Button>
                <div>
                  <h1 className="text-sm font-semibold text-slate-900 leading-tight">{currentView.title}</h1>
                </div>
              </div>
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-emerald-600 text-white text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ThemeToggle />
              <NotificationBell />
            </div>
          </div>
        )}

        {/* Desktop Page Header */}
        {isDesktop && (
          <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
            <div className="px-4 lg:px-6 h-10 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm flex-shrink-0">
                <span className="text-slate-400">CRM ALBRA</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                <span className="font-medium text-slate-900">{currentView.title}</span>
              </div>
              <div className="flex-1 max-w-md hidden lg:block">
                <GlobalSearch />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="hidden xl:block text-xs text-slate-400">
                  {currentView.subtitle}
                </div>
                <ThemeToggle />
                <NotificationBell />
              </div>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="p-3 md:p-4 lg:p-5 max-w-[1600px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
