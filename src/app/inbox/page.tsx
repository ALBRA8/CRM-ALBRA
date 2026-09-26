import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Bandeja · CRM ALBRA' }

/** /inbox — bandeja omnicanal (WhatsApp + Telegram + Instagram) con deep-link. */
export default function InboxRoute() {
  return <AppShell initialView="inbox" />
}
