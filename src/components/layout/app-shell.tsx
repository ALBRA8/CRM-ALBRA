'use client'

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import { pathForView, viewFromPath, VIEW_PERMISSIONS } from '@/lib/views'
import { can } from '@/lib/rbac'
import { LandingPage } from '@/components/landing/landing-page'
import { AppLayout } from '@/components/layout/app-layout'
import { DashboardPage } from '@/components/dashboard/dashboard-page'
import { ClientsList } from '@/components/clients/clients-list'
import { ClientDetail } from '@/components/clients/client-detail'
import { PipelineView } from '@/components/opportunities/pipeline-view'
import { CalendarPage } from '@/components/calendar/calendar-page'
import { AutomationsPage } from '@/components/automations/automations-page'
import { ChatPage } from '@/components/chat/chat-page'
import { QuotesList } from '@/components/quotes/quotes-list'
import { QuoteDetail } from '@/components/quotes/quote-detail'
import { FinancesPage } from '@/components/finances/finances-page'
import { SettingsPage } from '@/components/settings/settings-page'
import { ProductsPage } from '@/components/products/products-page'
import { WhatsAppPage } from '@/components/whatsapp/whatsapp-page'
import { TeamPage } from '@/components/team/team-page'
import { ActivityPage } from '@/components/activity/activity-page'
import { ReportsPage } from '@/components/reports/reports-page'
import { Card, CardContent } from '@/components/ui/card'
import { ShieldAlert } from 'lucide-react'
import { Toaster } from 'sonner'

/**
 * AppShell (Fase 2: migración SPA → App Router con deep-linking).
 *
 * ÚNICO dueño de la lógica de arranque y del estado URL↔vista:
 *  - Boot: migra el token legado, deduce la vista inicial de la ruta real
 *    (prop de la página > pathname) y autentica con Bearer o cookie httpOnly.
 *  - URL sync: cada cambio de vista hace pushState (el primero, replaceState,
 *    para no ensuciar el historial al aterrizar en /); popstate restaura la vista.
 *  - Guardas RBAC por vista (UX): el servidor siempre re-valida con
 *    requirePermission; aquí se muestra un panel "sin permisos".
 *
 * Cada ruta de src/app/ (/dashboard, /clients/[id], ...) renderiza este shell
 * con su vista inicial, de modo que refresh y links compartidos caen en el
 * mismo árbol de componentes sin duplicar lógica.
 */

interface AppShellProps {
  initialView?: string
  initialClientId?: string | null
  initialQuoteId?: string | null
}

function BootScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/25">
          <span className="text-white font-bold text-xl">A</span>
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <p className="text-sm text-slate-400 mt-3">Cargando CRM ALBRA...</p>
      </div>
    </div>
  )
}

function NoAccess({ capability }: { capability: string }) {
  return (
    <div className="p-6 max-w-lg mx-auto mt-10">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Sin permisos para este módulo</h2>
          <p className="text-sm text-slate-500 mt-2">
            Tu rol no incluye la capacidad <code className="text-xs bg-slate-100 rounded px-1.5 py-0.5">{capability}</code>.
            Pide al dueño o admin de la organización que te asigne el rol adecuado.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/** URL ↔ vista: pushState en cada cambio, replaceState en el primer sync, popstate restaura. */
function useUrlSync(active: boolean) {
  const view = useAppStore((s) => s.view)
  const selectedClientId = useAppStore((s) => s.selectedClientId)
  const selectedQuoteId = useAppStore((s) => s.selectedQuoteId)
  const firstSync = useRef(true)

  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    const target = pathForView(view, { clientId: selectedClientId, quoteId: selectedQuoteId })
    const current = window.location.pathname
    if (current === target) return
    if (view === 'landing' || firstSync.current) {
      window.history.replaceState(null, '', target)
    } else {
      window.history.pushState(null, '', target)
    }
    firstSync.current = false
  }, [active, view, selectedClientId, selectedQuoteId])

  useEffect(() => {
    if (!active) return
    const onPopState = () => {
      const st = useAppStore.getState()
      const state = viewFromPath(window.location.pathname)
      if (state.clientId && state.clientId !== st.selectedClientId) st.setSelectedClientId(state.clientId)
      if (state.quoteId && state.quoteId !== st.selectedQuoteId) st.setSelectedQuoteId(state.quoteId)
      st.setView(state.view)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [active])
}

/** Boot de autenticación compartido por todas las rutas. */
function useAuthBoot(initial: AppShellProps) {
  const { setToken, setUser, setView, setSelectedClientId, setSelectedQuoteId } = useAppStore()
  const [initializing, setInitializing] = useState(true)
  const initialized = useRef(false)

  const init = useCallback(() => {
    if (initialized.current) return
    initialized.current = true

    // Deep-link directo a detalle: /clients/[id] o /quotes/[id]
    if (initial.initialClientId) setSelectedClientId(initial.initialClientId)
    if (initial.initialQuoteId) setSelectedQuoteId(initial.initialQuoteId)

    // Legado: versiones anteriores guardaban el JWT en localStorage
    // ('crm_token', superficie XSS). Se migra: se elimina del storage y el
    // token solo vive en memoria; la persistencia de sesión es la cookie
    // httpOnly que setea el servidor en login/register/demo.
    if (typeof window !== 'undefined') {
      const legacyToken = localStorage.getItem('crm_token')
      if (legacyToken) {
        localStorage.removeItem('crm_token')
        setToken(legacyToken)
        api.setToken(legacyToken)
      }
      // La ruta real manda (deep-link); en "/" arranca el dashboard.
      const fromUrl = viewFromPath(window.location.pathname)
      setView(initial.initialView ?? (fromUrl.view !== 'landing' ? fromUrl.view : 'dashboard'))
    }

    // Con token en memoria (legado o login reciente) se manda Bearer; si no,
    // getMe autentica vía cookie httpOnly. Si ninguna vale → landing.
    api.getMe()
      .then((data) => {
        setUser(data.user as { id: string; name: string; email: string; company?: string | null; phone?: string | null; role: string; avatar?: string | null })
        setInitializing(false)
      })
      .catch(() => {
        setToken(null)
        setUser(null)
        setView('landing')
        setInitializing(false)
      })
  }, [initial.initialClientId, initial.initialQuoteId, initial.initialView, setToken, setUser, setView, setSelectedClientId, setSelectedQuoteId])

  useEffect(() => {
    init()
  }, [init])

  return initializing
}

function renderView(view: string): ReactNode {
  switch (view) {
    case 'dashboard':
      return <DashboardPage />
    case 'clients':
      return <ClientsList />
    case 'client-detail':
      // Deep-link sin id válido (o id de otra sesión): cae al listado
      return useAppStore.getState().selectedClientId ? <ClientDetail /> : <ClientsList />
    case 'opportunities':
      return <PipelineView />
    case 'calendar':
      return <CalendarPage />
    case 'products':
      return <ProductsPage />
    case 'whatsapp':
      return <WhatsAppPage />
    case 'automations':
      return <AutomationsPage />
    case 'chat':
      return <ChatPage />
    case 'quotes':
      return <QuotesList />
    case 'quote-detail':
      return useAppStore.getState().selectedQuoteId ? <QuoteDetail /> : <QuotesList />
    case 'finances':
      return <FinancesPage />
    case 'reports':
      return <ReportsPage />
    case 'team':
      return <TeamPage />
    case 'activity':
      return <ActivityPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <DashboardPage />
  }
}

export function AppShell({ initialView, initialClientId, initialQuoteId }: AppShellProps) {
  const { view, token, user } = useAppStore()
  const initializing = useAuthBoot({ initialView, initialClientId, initialQuoteId })
  useUrlSync(!initializing)

  if (initializing) return <BootScreen />

  // Sin sesión (ni token en memoria ni usuario vía cookie) → landing
  if (!token && !user) {
    return (
      <>
        <LandingPage />
        <Toaster position="top-right" richColors />
      </>
    )
  }

  // Guarda RBAC de vista (UX; el servidor re-valida cada API)
  const required = VIEW_PERMISSIONS[view]
  const content = required && user && !can(user.role, required)
    ? <NoAccess capability={required} />
    : renderView(view)

  return (
    <>
      <AppLayout>
        {content}
      </AppLayout>
      <Toaster position="top-right" richColors />
    </>
  )
}
