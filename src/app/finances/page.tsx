import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Finanzas · CRM ALBRA' }

/** /finances — ingresos/egresos (Fase 2). */
export default function FinancesRoute() {
  return <AppShell initialView="finances" />
}
