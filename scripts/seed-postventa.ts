/**
 * Migración idempotente: crea la automatización "Secuencia post-venta" en todas
 * las organizaciones existentes (con el motor de pausas durable del Task 6).
 *
 * Uso: DATABASE_URL="file:/home/z/my-project/db/custom.db" bun scripts/seed-postventa.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const ACTIONS = JSON.stringify([
  { type: 'wait', config: { days: 3 } },
  { type: 'send_whatsapp', config: { body: 'Hola {{clientName}}, ¿qué tal va todo con {{title}}? Queremos asegurarnos de que quedes 100% satisfecho con el resultado. Cualquier cosa que necesites, nos cuentas.' } },
  { type: 'wait', config: { days: 4 } },
  { type: 'ai_followup', config: { instruction: 'Redacta un mensaje corto y cordial que agradezca la confianza y pida una reseña o recomendación tras cerrar el servicio. Si percibes insatisfacción en el historial, ofrece en su lugar una llamada de seguimiento.' } },
])

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } })
  let created = 0
  let existing = 0

  for (const org of orgs) {
    const already = await db.automation.findFirst({
      where: { organizationId: org.id, name: 'Secuencia post-venta' },
      select: { id: true },
    })
    if (already) {
      existing++
      console.log(`= ${org.name}: ya existe, se omite`)
      continue
    }
    await db.automation.create({
      data: {
        organizationId: org.id,
        name: 'Secuencia post-venta',
        category: 'seguimiento',
        description: 'Tras ganar una oportunidad: check-in de satisfacción por WhatsApp al día 3 y seguimiento IA con pedido de reseña al día 7.',
        triggerType: 'opportunity_stage_changed',
        conditions: JSON.stringify([{ field: 'toStage', operator: 'equals', value: 'Cierre Ganado' }]),
        actions: ACTIONS,
        isActive: true,
      },
    })
    created++
    console.log(`+ ${org.name}: creada`)
  }

  console.log(`\nResultado: ${created} creadas, ${existing} ya existían (${orgs.length} organizaciones)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
