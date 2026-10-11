const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  const org = await db.organization.findFirst()
  const client = await db.client.findFirst({ where: { organizationId: org.id } })
  const stage = await db.pipelineStage.findFirst({ where: { organizationId: org.id }, orderBy: { order: 'asc' } })
  const q = await db.quote.create({
    data: {
      organizationId: org.id,
      number: 'COT-0001',
      clientId: client.id,
      subtotal: 1400,
      tax: 216,
      total: 1616,
      currency: 'USD',
      status: 'sent',
      validUntil: new Date(Date.now() + 15 * 864e5),
      notes: 'Precios incluyen soporte por 6 meses. Válida para (nuevos) proyectos \\ presupuestados.',
      items: {
        create: [
          { sku: 'ASE-CNT', description: 'Asesoría contable especializada (mensual)', quantity: 2, unitPrice: 500, subtotal: 1000, position: 0 },
          { description: 'Licencia anual CRM con onboarding e implementación', quantity: 1, unitPrice: 400, subtotal: 400, position: 1 },
        ],
      },
    },
  })
  console.log('CREADA', q.id, q.number)
  await db.opportunity.create({
    data: {
      organizationId: org.id, title: 'Implementación CRM anual', clientId: client.id,
      stageId: stage?.id, amount: 1616, status: 'open', source: 'manual',
    },
  })
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
