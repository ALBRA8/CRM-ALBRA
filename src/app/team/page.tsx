import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Equipo · CRM ALBRA' }

/** /team — gestión de equipo; módulo owner/admin (team.manage). */
export default function TeamRoute() {
  return <AppShell initialView="team" />
}
