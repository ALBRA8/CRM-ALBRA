import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Calendario · CRM ALBRA' }

/** /calendar — reservas y agenda (Fase 2). */
export default function CalendarRoute() {
  return <AppShell initialView="calendar" />
}
