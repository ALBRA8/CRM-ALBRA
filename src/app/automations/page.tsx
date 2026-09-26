import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Automatizaciones · CRM ALBRA' }

/** /automations — módulo owner/admin (la API re-valida automations.write). */
export default function AutomationsRoute() {
  return <AppShell initialView="automations" />
}
