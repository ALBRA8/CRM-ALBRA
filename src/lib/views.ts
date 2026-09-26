/**
 * Mapa vista-URL del CRM (Fase 2: deep-linking).
 *
 * La app navega en modo SPA (setView, sin recarga) pero la URL SIEMPRE
 * refleja el estado: history.pushState en cada cambio de vista y lectura
 * del pathname al bootear. Cada ruta tiene además su archivo App Router
 * (src/app/dashboard/page.tsx, etc.) para que refresh y link compartidos
 * carguen directamente (verificado con el gateway: todas las rutas llegan
 * a la app en el puerto 3000).
 */

export interface ViewState {
  view: string
  clientId?: string
  quoteId?: string
}

/** Vistas sin parámetros → ruta estática. */
const STATIC_VIEW_PATH: Record<string, string> = {
  dashboard: '/dashboard',
  clients: '/clients',
  opportunities: '/pipeline',
  calendar: '/calendar',
  products: '/products',
  quotes: '/quotes',
  whatsapp: '/whatsapp',
  inbox: '/inbox',
  automations: '/automations',
  chat: '/chat',
  finances: '/finances',
  reports: '/reports',
  team: '/team',
  activity: '/activity',
  settings: '/settings',
}

/** Ruta inversa (path → view), generada para nunca divergir. */
const PATH_TO_VIEW: Record<string, string> = Object.fromEntries(
  Object.entries(STATIC_VIEW_PATH).map(([view, path]) => [path, view])
)

/** Capacidad RBAC mínima por vista (guardas de AppShell; el servidor re-valida). */
export const VIEW_PERMISSIONS: Record<string, string> = {
  dashboard: 'clients.read',
  clients: 'clients.read',
  'client-detail': 'clients.read',
  opportunities: 'opportunities.read',
  calendar: 'reservations.read',
  products: 'services.read',
  quotes: 'quotes.read',
  'quote-detail': 'quotes.read',
  whatsapp: 'whatsapp.read',
  inbox: 'whatsapp.read',
  automations: 'automations.read',
  chat: 'ai.use',
  finances: 'transactions.read',
  reports: 'reports.read',
  team: 'team.manage',
  activity: 'activity.read',
  settings: 'settings.read',
}

/** Construye la URL canónica de una vista (con sus ids de detalle si aplica). */
export function pathForView(
  view: string,
  ids: { clientId?: string | null; quoteId?: string | null } = {}
): string {
  if (view === 'landing') return '/'
  if (view === 'client-detail') {
    return ids.clientId ? `/clients/${encodeURIComponent(ids.clientId)}` : '/clients'
  }
  if (view === 'quote-detail') {
    return ids.quoteId ? `/quotes/${encodeURIComponent(ids.quoteId)}` : '/quotes'
  }
  return STATIC_VIEW_PATH[view] ?? '/dashboard'
}

/** Interpreta un pathname a vista (+ ids de detalle). Desconocido → dashboard. */
export function viewFromPath(pathname: string): ViewState {
  const path = (pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/'
  if (path === '/') return { view: 'landing' }

  const clientMatch = path.match(/^\/clients\/([^/]+)$/)
  if (clientMatch) return { view: 'client-detail', clientId: decodeURIComponent(clientMatch[1]) }

  const quoteMatch = path.match(/^\/quotes\/([^/]+)$/)
  if (quoteMatch) return { view: 'quote-detail', quoteId: decodeURIComponent(quoteMatch[1]) }

  const view = PATH_TO_VIEW[path]
  return { view: view ?? 'dashboard' }
}
