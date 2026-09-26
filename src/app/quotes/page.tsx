import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Cotizaciones · CRM ALBRA' }

/** /quotes — listado de cotizaciones (Fase 2). */
export default function QuotesRoute() {
  return <AppShell initialView="quotes" />
}
