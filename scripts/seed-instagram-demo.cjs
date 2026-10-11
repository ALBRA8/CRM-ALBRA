// Semilla de conversación demo de Instagram para la bandeja omnicanal.
// Crea 3 TimelineEvents type='instagram' para Laura Martínez (DM entrante,
// respuesta del agente IA, DM saliente) con el shape de metadata que
// listTimelineConversations() espera (direction, senderId, readAt).
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  const org = await db.organization.findFirst()
  if (!org) throw new Error('No hay organización demo; corre POST /api/auth/demo primero')

  const client = await db.client.findFirst({ where: { organizationId: org.id, name: { contains: 'Laura' } } })
  if (!client) throw new Error('No se encontró cliente "Laura" en la org demo')
  console.log(`Org: ${org.name} · Cliente: ${client.name} (${client.id})`)

  const existing = await db.timelineEvent.count({
    where: { organizationId: org.id, clientId: client.id, type: 'instagram' },
  })
  if (existing > 0) {
    console.log(`Ya hay ${existing} eventos instagram para ${client.name}; no duplico.`)
    return
  }

  const now = Date.now()
  const mk = (ms, title, description, direction, source, senderId) =>
    db.timelineEvent.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        type: 'instagram',
        title,
        description,
        source,
        metadata: JSON.stringify({
          direction,
          senderId: senderId || 'ig-contact-17841400000000000',
          ...(direction === 'in' ? {} : { readAt: new Date(ms).toISOString() }),
        }),
        createdAt: new Date(ms),
      },
    })

  await mk(now - 1000 * 60 * 62, 'Instagram DM', 'Hola! Vi sus productos, ¿hacen envíos a Medellín?', 'in', 'integration')
  await mk(now - 1000 * 60 * 60, 'Instagram DM', '¡Hola Laura! Claro que sí, enviamos a todo el país 📦 ¿Qué producto te interesa?', 'out', 'agent')
  await mk(now - 1000 * 60 * 55, 'Instagram DM', 'Me interesa el plan Pro, ¿tienen demo?', 'in', 'integration')
  console.log('Semilla instagram: 3 eventos creados (2 entrantes, 1 respuesta agente IA).')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
