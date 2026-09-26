import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'WhatsApp · CRM ALBRA' }

/** /whatsapp — bandeja de canal (Fase 2). */
export default function WhatsAppRoute() {
  return <AppShell initialView="whatsapp" />
}
