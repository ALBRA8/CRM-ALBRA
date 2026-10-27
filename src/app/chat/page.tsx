import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Chat AI · CRM ALBRA' }

/** /chat — agente comercial IA (Fase 2). */
export default function ChatRoute() {
  return <AppShell initialView="chat" />
}
