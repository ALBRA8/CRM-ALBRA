import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = { title: 'Productos y Servicios · CRM ALBRA' }

/** /products — catálogo (Fase 2). */
export default function ProductsRoute() {
  return <AppShell initialView="products" />
}
