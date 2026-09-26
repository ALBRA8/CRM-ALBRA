import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Clientes · CRM ALBRA' }

/** /clients — deep-link directo al listado de clientes (Fase 2). */
export default function ClientsRoute() {
  return <AppShell initialView="clients" />
}
