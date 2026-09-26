import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Reportes · CRM ALBRA' }

/** /reports — métricas de negocio; módulo owner/admin (reports.read). */
export default function ReportsRoute() {
  return <AppShell initialView="reports" />
}
