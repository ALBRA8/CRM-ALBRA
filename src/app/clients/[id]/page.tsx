import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Cliente · CRM ALBRA' }

/**
 * /clients/[id] — detalle de cliente compartible (Fase 2).
 * El id viaja como prop y AppShell lo fija en el store antes de renderizar.
 */
export default async function ClientDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AppShell initialView="client-detail" initialClientId={id} />
}
