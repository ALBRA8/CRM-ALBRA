import { AppShell } from '@/components/layout/app-shell'

/**
 * "/" — entrada de la app. Fase 2: toda la lógica vive en AppShell
 * (src/components/layout/app-shell.tsx), compartido con las rutas
 * /dashboard, /clients/[id], /quotes/[id], etc. para deep-linking.
 */
export default function Home() {
  return <AppShell />
}
