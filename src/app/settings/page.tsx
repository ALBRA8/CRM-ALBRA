import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Configuración · CRM ALBRA' }

/** /settings — configuración; módulo owner/admin (settings.read). */
export default function SettingsRoute() {
  return <AppShell initialView="settings" />
}
