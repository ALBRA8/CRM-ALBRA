/**
 * Datos de la semilla de la BD de prueba (db/test-vitest.db).
 * Constantes puras, sin Prisma: las importan tanto el setup (para sembrar)
 * como los tests (para conocer los IDs sin tocar la BD).
 *
 * NUNCA apuntar DATABASE_URL a db/custom.db — esa es la BD viva de producción.
 */

export const FIX = {
  orgA: { id: 'org-a', name: 'Organización Alfa (tests)', slug: 'test-org-alfa' },
  orgB: { id: 'org-b', name: 'Organización Beta (tests)', slug: 'test-org-beta' },
  orgC: { id: 'org-c', name: 'Organización Vacía (tests)', slug: 'test-org-vacia' },

  userA: {
    id: 'user-a',
    email: 'owner-a@test.albra',
    name: 'Owner Alfa',
    passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128),
    role: 'owner',
    organizationId: 'org-a',
  },
  userB: {
    id: 'user-b',
    email: 'member-b@test.albra',
    name: 'Member Beta',
    passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128),
    role: 'member',
    organizationId: 'org-b',
  },

  clientA1: { id: 'client-a1', organizationId: 'org-a', name: 'Cliente Alpha', email: 'alpha@test.albra', status: 'active' },
  clientA2: { id: 'client-a2', organizationId: 'org-a', name: 'Cliente Gamma', email: 'gamma@test.albra', status: 'prospect' },
  clientB1: { id: 'client-b1', organizationId: 'org-b', name: 'Cliente Beta Org B', email: 'beta@test.albra', status: 'active' },

  // Transacciones org A: Ingresos 1000 + 400 = 1400, Egresos 60 → Balance 1340.
  // La tx con type 'income' (inglés) documenta que el filtro de reportes solo
  // cuenta el vocabulario real de la BD ('ingreso'/'egreso') — behavior actual
  // tras la corrección del crítico #5 de la auditoría.
  txIngreso1: { id: 'tx-ingreso-1', organizationId: 'org-a', type: 'ingreso', amount: 1000, currency: 'USD', category: 'ventas', description: 'Pago factura 1', clientId: 'client-a1' },
  txIngreso2: { id: 'tx-ingreso-2', organizationId: 'org-a', type: 'ingreso', amount: 400, currency: 'USD', category: 'ventas', description: 'Pago factura 2', clientId: null },
  txEgreso1: { id: 'tx-egreso-1', organizationId: 'org-a', type: 'egreso', amount: 60, currency: 'USD', category: 'servicios', description: 'Suscripción tooling', clientId: null },
  txIncomeEnglish: { id: 'tx-income-en', organizationId: 'org-a', type: 'income', amount: 9999, currency: 'USD', category: 'otros', description: 'Tipo en inglés (no debe contar)', clientId: null },
  txOrgB: { id: 'tx-org-b-1', organizationId: 'org-b', type: 'ingreso', amount: 500, currency: 'USD', category: 'ventas', description: 'Ingreso org B', clientId: 'client-b1' },

  knowledgeA1: { id: 'know-a1', organizationId: 'org-a', title: 'Catálogo 2025', content: 'El Producto Estrella cuesta 50 USD y se entrega en 3 días.', category: 'catalogo', isActive: true },
  knowledgeA2: { id: 'know-a2', organizationId: 'org-a', title: 'Horario FAQ', content: 'Abrimos de 8 a 18 horas de lunes a viernes.', category: 'faq', isActive: true },
  knowledgeA3: { id: 'know-a3', organizationId: 'org-a', title: 'Nota interna borrador', content: 'CONTENIDO INACTIVO NO DEBE APARECER', category: 'general', isActive: false },
  knowledgeB1: { id: 'know-b1', organizationId: 'org-b', title: 'FAQ Org B', content: 'CONTENIDO EXCLUSIVO DE ORG B', category: 'faq', isActive: true },
} as const
