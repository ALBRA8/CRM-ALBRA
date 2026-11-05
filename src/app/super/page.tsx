import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

// Plano de control multi-organización. La guarda real vive en el servidor
// (requireSuperAdmin en /api/super/*) y en AppShell (VIEW_PERMISSIONS.super).
export const metadata: Metadata = { title: 'Super Admin · CRM ALBRA' }

export default function SuperRoute() {
  return <AppShell initialView="super" />
}
