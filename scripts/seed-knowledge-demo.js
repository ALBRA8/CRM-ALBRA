// Siembra las 2 entradas demo de conocimiento en la organización demo EXISTENTE
// (si aún no tiene ninguna), para que el usuario las vea funcionando de inmediato.
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!org) return console.log('Sin organizaciones')
  const existing = await db.knowledge.count({ where: { organizationId: org.id } })
  if (existing > 0) return console.log(`La org ${org.name} ya tiene ${existing} entradas de conocimiento`)

  await db.knowledge.createMany({
    data: [
      {
        organizationId: org.id,
        title: 'Catálogo de servicios y precios',
        category: 'catalogo',
        content:
          'Nuestro producto estrella es la Consultoría CRM ALBRA (precio: $2,500). También ofrecemos auditorías de datos por $1,200 y desarrollo de sitios web corporativos desde $2,000. El hosting y mantenimiento anual cuesta $300.',
        isActive: true,
      },
      {
        organizationId: org.id,
        title: 'Términos y condiciones',
        category: 'terminos',
        content:
          'Los pagos se realizan vía transferencia o link de pago. Tenemos garantía de 12 meses en todos nuestros productos tecnológicos. Las revisiones están incluidas según el alcance acordado en cada cotización.',
        isActive: true,
      },
    ],
  })
  console.log(`Sembradas 2 entradas de conocimiento en la org "${org.name}"`)
}

main().finally(() => db.$disconnect())
