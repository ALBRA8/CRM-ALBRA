import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Actividad · CRM ALBRA' }

/** /activity — auditoría de actividad (Fase 2). */
export default function ActivityRoute() {
  return <AppShell initialView="activity" />
}
