/**
 * Siembra conversaciones de demostración para la Bandeja omnicanal (Fase 4)
 * en la organización demo: 1 hilo de WhatsApp (tablas del daemon) + 1 de
 * Telegram (timeline), vinculados a clientes demo existentes.
 * Idempotente: usa claves fijas (teléfono / chatId) y upsert lógico.
 * Uso: node scripts/seed-inbox-demo.mjs
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const ORG_SLUG = 'albra-demo'

const org = await db.organization.findUnique({ where: { slug: ORG_SLUG }, select: { id: true } })
if (!org) throw new Error('No existe la organización demo (corre el login demo primero)')

const clients = await db.client.findMany({
  where: { organizationId: org.id },
  orderBy: { createdAt: 'asc' },
  take: 3,
  select: { id: true, name: true, phone: true },
})
const now = new Date()

// --- WhatsApp (tablas propias del daemon) ---
const waClient = clients[0]
if (waClient) {
  const waPhone = waClient.phone || '+573001234567'
  const conv = await db.whatsAppConversation.upsert({
    where: { organizationId_contactPhone: { organizationId: org.id, contactPhone: waPhone } },
    update: { lastMessage: 'Perfecto, quedo atento a la confirmación', lastMessageFrom: 'in', lastMessageAt: now, unreadCount: 1, clientId: waClient.id, contactName: waClient.name },
    create: {
      organizationId: org.id,
      clientId: waClient.id,
      contactPhone: waPhone,
      contactName: waClient.name,
      lastMessage: 'Perfecto, quedo atento a la confirmación',
      lastMessageFrom: 'in',
      lastMessageAt: now,
      unreadCount: 1,
      isAutoReply: true,
    },
  })
  const count = await db.whatsAppMessage.count({ where: { conversationId: conv.id } })
  if (count === 0) {
    const t = (min) => new Date(now.getTime() - min * 60000)
    await db.whatsAppMessage.createMany({
      data: [
        { organizationId: org.id, conversationId: conv.id, direction: 'inbound', fromNumber: waPhone, toNumber: 'biz', senderType: 'contact', text: 'Hola, ¿tienen cita disponible mañana?', createdAt: t(40) },
        { organizationId: org.id, conversationId: conv.id, direction: 'outbound', fromNumber: 'biz', toNumber: waPhone, senderType: 'agent', text: '¡Hola! Sí, tenemos espacio a las 10 am o 3 pm. ¿Cuál te acomoda mejor?', createdAt: t(36) },
        { organizationId: org.id, conversationId: conv.id, direction: 'inbound', fromNumber: waPhone, toNumber: 'biz', senderType: 'contact', text: 'Perfecto, quedo atento a la confirmación', createdAt: t(2) },
      ],
    })
  }
  console.log(`WhatsApp demo: conv ${conv.id} (${waPhone})`)
}

// --- Telegram (timeline, agrupado por cliente) ---
const tgClient = clients[1]
if (tgClient) {
  const existing = await db.timelineEvent.findFirst({
    where: { organizationId: org.id, type: 'telegram', clientId: tgClient.id },
    select: { id: true },
  })
  if (!existing) {
    const t = (min) => new Date(now.getTime() - min * 60000)
    await db.timelineEvent.createMany({
      data: [
        { organizationId: org.id, clientId: tgClient.id, type: 'telegram', title: `Mensaje recibido de ${tgClient.name}`, description: 'Buenas, ¿el producto incluye garantía?', metadata: JSON.stringify({ chatId: '900001', direction: 'in' }), source: 'integration', createdAt: t(90) },
        { organizationId: org.id, clientId: tgClient.id, type: 'telegram', title: 'Respuesta automática del agente IA', description: '¡Claro! Todos nuestros productos incluyen 12 meses de garantía.', metadata: JSON.stringify({ chatId: '900001', direction: 'out', delivered: true }), source: 'agent', createdAt: t(88) },
        { organizationId: org.id, clientId: tgClient.id, type: 'telegram', title: `Mensaje recibido de ${tgClient.name}`, description: 'Y ¿hacen envíos a Medellín?', metadata: JSON.stringify({ chatId: '900001', direction: 'in' }), source: 'integration', createdAt: t(5) },
      ],
    })
  }
  console.log(`Telegram demo: timeline de ${tgClient.name}`)
}

console.log('Semilla de bandeja demo lista')
await db.$disconnect()
