import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Pipeline · CRM ALBRA' }

/** /pipeline — kanban de oportunidades (vista "opportunities"). */
export default function PipelineRoute() {
  return <AppShell initialView="opportunities" />
}
