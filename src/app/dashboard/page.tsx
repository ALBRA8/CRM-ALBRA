import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Dashboard · CRM ALBRA' }

/** /dashboard — deep-link directo al panel principal (Fase 2). */
export default function DashboardRoute() {
  return <AppShell initialView="dashboard" />
}
