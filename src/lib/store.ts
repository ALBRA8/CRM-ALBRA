'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: string
  email: string
  name: string
  company?: string | null
  phone?: string | null
  role: string
  avatar?: string | null
}

interface AppState {
  view: string
  setView: (view: string) => void
  user: User | null
  setUser: (user: User | null) => void
  token: string | null
  setToken: (token: string | null) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  selectedClientId: string | null
  setSelectedClientId: (id: string | null) => void
  selectedOpportunityId: string | null
  setSelectedOpportunityId: (id: string | null) => void
  selectedQuoteId: string | null
  setSelectedQuoteId: (id: string | null) => void
  isAdmin: boolean
  setIsAdmin: (v: boolean) => void
  logout: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: 'landing',
      setView: (view) => set({ view }),
      user: null,
      setUser: (user) => set({ user, isAdmin: user?.role === 'owner' || user?.role === 'admin' }),
      token: null,
      setToken: (token) => set({ token }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      selectedClientId: null,
      setSelectedClientId: (id) => set({ selectedClientId: id }),
      selectedOpportunityId: null,
      setSelectedOpportunityId: (id) => set({ selectedOpportunityId: id }),
      selectedQuoteId: null,
      setSelectedQuoteId: (id) => set({ selectedQuoteId: id }),
      isAdmin: false,
      setIsAdmin: (v) => set({ isAdmin: v }),
      logout: () => {
        // Borra también la cookie httpOnly en el servidor (fire-and-forget):
        // si el fetch falla (offline), el estado local se limpia igual.
        try {
          void fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
        } catch {
          // noop en SSR
        }
        set({ user: null, token: null, view: 'landing', isAdmin: false })
      },
    }),
    {
      name: 'crm-albra-store',
      // El token NO se persiste (superficie XSS): la sesión tras F5 la
      // mantiene la cookie httpOnly; el token en memoria solo vive en la pestaña.
      partialize: (state) => {
        const snapshot = state as unknown as Record<string, unknown>
        const { token: _omit, ...rest } = snapshot
        void _omit
        return rest
      },
    }
  )
)
