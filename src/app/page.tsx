'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
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
import { Toaster } from 'sonner'
import { ReportsPage } from '@/components/reports/reports-page'

function useAuthInit() {
  const { setToken, setUser, setView } = useAppStore()
  const [initializing, setInitializing] = useState(true)
  const initialized = useRef(false)

  const init = useCallback(() => {
    if (initialized.current) return
    initialized.current = true

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
    }

    // Con token en memoria (legado o login reciente) se manda Bearer; si no,
    // getMe autentica vía cookie httpOnly. Si ninguna vale → landing.
    api.getMe()
      .then((data) => {
        setUser(data.user as { id: string; name: string; email: string; company?: string | null; phone?: string | null; role: string; avatar?: string | null })
        setView('dashboard')
        setInitializing(false)
      })
      .catch(() => {
        setToken(null)
        setUser(null)
        setView('landing')
        setInitializing(false)
      })
  }, [setToken, setUser, setView])

  useEffect(() => {
    init()
  }, [init])

  return initializing
}

export default function Home() {
  const { view, token } = useAppStore()
  const initializing = useAuthInit()

  if (initializing) {
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

  // Not authenticated - show landing
  if (!token) {
    return (
      <>
        <LandingPage />
        <Toaster position="top-right" richColors />
      </>
    )
  }

  // Authenticated - show app
  const renderView = () => {
    switch (view) {
      case 'dashboard':
        return <DashboardPage />
      case 'clients':
        return <ClientsList />
      case 'client-detail':
        return <ClientDetail />
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
        return <QuoteDetail />
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

  return (
    <>
      <AppLayout>
        {renderView()}
      </AppLayout>
      <Toaster position="top-right" richColors />
    </>
  )
}
