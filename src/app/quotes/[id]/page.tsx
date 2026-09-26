import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Cotización · CRM ALBRA' }

/** /quotes/[id] — detalle de cotización compartible (Fase 2). */
export default async function QuoteDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AppShell initialView="quote-detail" initialQuoteId={id} />
}
