import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { ensureClientAttrFields, saveClientAttrs } from './clients'

/**
 * Semilla estándar de pipeline + organización demo con datos de ejemplo.
 * Usada por POST /api/auth/register y POST /api/auth/demo.
 */

export const STANDARD_STAGES: Array<{ name: string; probability: number; color: string; isWon?: boolean; isLost?: boolean }> = [
  { name: 'Prospección', probability: 0.1, color: '#64748b' },
  { name: 'Calificación', probability: 0.3, color: '#0ea5e9' },
  { name: 'Oferta', probability: 0.5, color: '#f97316' },
  { name: 'Seguimiento', probability: 0.75, color: '#f59e0b' },
  { name: 'Cierre Ganado', probability: 1, color: '#10b981', isWon: true },
  { name: 'Cierre Perdido', probability: 0, color: '#ef4444', isLost: true },
]

export async function createStandardPipeline(orgId: string): Promise<void> {
  await db.pipelineStage.createMany({
    data: STANDARD_STAGES.map((s, i) => ({
      organizationId: orgId,
      name: s.name,
      order: i + 1,
      color: s.color,
      probability: s.probability,
      isWon: s.isWon ?? false,
      isLost: s.isLost ?? false,
    })),
  })
}

export async function createOrgSettings(orgId: string, rubro?: string): Promise<void> {
  await db.settings.create({ data: { organizationId: orgId } })
  await db.nichoConfig.create({
    data: {
      organizationId: orgId,
      brandingName: 'CRM ALBRA',
      rubro: rubro ?? 'Servicios Profesionales',
      personality: 'Profesional, empático y orientado a resultados',
    },
  })
}

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000)
const daysFromNow = (n: number, hour = 10): Date => {
  const d = new Date(Date.now() + n * 86_400_000)
  d.setHours(hour, 0, 0, 0)
  return d
}

export interface DemoSeedResult {
  orgId: string
  userId: string
  created: boolean
}

/**
 * Crea (o reutiliza) la organización demo y siembra datos de ejemplo.
 * Si la org ya existe con clientes, no vuelve a sembrar.
 */
export async function ensureDemoOrganization(): Promise<DemoSeedResult> {
  const email = 'demo@crmalbra.com'
  const existingUser = await db.user.findUnique({ where: { email } })
  if (existingUser) {
    const clientCount = await db.client.count({ where: { organizationId: existingUser.organizationId } })
    if (clientCount > 0) {
      return { orgId: existingUser.organizationId, userId: existingUser.id, created: false }
    }
    await seedDemoData(existingUser.organizationId)
    return { orgId: existingUser.organizationId, userId: existingUser.id, created: false }
  }

  // Org demo nueva
  const org = await db.organization.create({
    data: { name: 'ALBRA Demo', slug: 'albra-demo', plan: 'pilot' },
  })
  const user = await db.user.create({
    data: {
      email,
      name: 'Equipo Demo ALBRA',
      passwordHash: hashPassword('demo1234'),
      role: 'owner',
      company: 'ALBRA Demo',
      phone: '+57 300 000 0000',
      organizationId: org.id,
    },
  })
  await createStandardPipeline(org.id)
  await createOrgSettings(org.id, 'Servicios Profesionales')
  await seedDemoData(org.id)
  return { orgId: org.id, userId: user.id, created: true }
}

async function seedDemoData(orgId: string): Promise<void> {
  const stages = await db.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { order: 'asc' } })
  const stageByName = new Map(stages.map((s) => [s.name, s]))
  const cotizado = stageByName.get('Oferta')
  const nuevo = stageByName.get('Prospección')

  const demoClients: Array<{
    name: string
    phone: string
    email: string | null
    status: string
    source: string
    lastContactAt: Date
    temperature: string
    company: string | null
    city: string | null
    notes: string | null
  }> = [
    { name: 'María González', phone: '+57 310 555 0101', email: 'maria@boutiquemaria.co', status: 'active', source: 'whatsapp', lastContactAt: daysAgo(1), temperature: 'Fuego', company: 'Boutique María', city: 'Bogotá', notes: 'Interesada en rediseño completo de su tienda online.' },
    { name: 'Carlos Rodríguez', phone: '+57 311 555 0102', email: 'carlos@contarod.co', status: 'active', source: 'referral', lastContactAt: daysAgo(4), temperature: 'Caliente', company: 'Conta Rodríguez', city: 'Medellín', notes: 'Referido por Ana. Quiere automatizar facturación.' },
    { name: 'Ana Martínez', phone: '+57 312 555 0103', email: 'ana.martinez@gmail.com', status: 'prospect', source: 'manual', lastContactAt: daysAgo(6), temperature: 'Caliente', company: null, city: 'Cali', notes: 'Consultó por paquete de marketing digital.' },
    { name: 'Jorge Ramírez', phone: '+57 313 555 0104', email: 'jorge@jrconsultores.co', status: 'active', source: 'whatsapp', lastContactAt: daysAgo(12), temperature: 'Tibio', company: 'JR Consultores', city: 'Medellín', notes: 'Evalúa consultoría mensual para su equipo.' },
    { name: 'Laura Sánchez', phone: '+57 314 555 0105', email: 'laura.sanchez@outlook.com', status: 'prospect', source: 'web', lastContactAt: daysAgo(20), temperature: 'Tibio', company: null, city: 'Barranquilla', notes: 'Llegó desde la landing page.' },
    { name: 'Diego Torres', phone: '+57 315 555 0106', email: 'diego@torresasociados.co', status: 'inactive', source: 'manual', lastContactAt: daysAgo(60), temperature: 'Frio', company: 'Torres & Asociados', city: 'Bogotá', notes: 'Sin respuesta en las últimas 3 campañas.' },
    { name: 'Valentina López', phone: '+57 316 555 0107', email: null, status: 'prospect', source: 'instagram', lastContactAt: daysAgo(9), temperature: 'Tibio', company: null, city: 'Cartagena', notes: 'Escribió por DM pidiendo precios.' },
    { name: 'Pedro Gómez', phone: '+57 317 555 0108', email: 'pedro@ferreteriaelpr.co', status: 'active', source: 'referral', lastContactAt: daysAgo(35), temperature: 'Frio', company: 'Ferretería El Preciso', city: 'Cali', notes: 'Cliente antiguo, requiere reactivación.' },
  ]

  const clients: Array<{ id: string; name: string }> = []
  await ensureClientAttrFields(orgId)
  for (const c of demoClients) {
    const created = await db.client.create({
      data: {
        organizationId: orgId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        status: c.status,
        source: c.source,
        lastContactAt: c.lastContactAt,
        notes: c.notes,
      },
      select: { id: true, name: true },
    })
    clients.push(created)
    // Atributos extendidos (temperature/company/city) como campos de sistema
    await saveClientAttrs(orgId, created.id, { temperature: c.temperature, company: c.company, city: c.city, tags: null })
  }

  const [maria, carlos, jorge] = clients

  // Oportunidades
  const opp1 = await db.opportunity.create({
    data: {
      organizationId: orgId,
      title: 'Diseño y desarrollo de sitio web',
      clientId: maria.id,
      stageId: cotizado?.id ?? null,
      amount: 2800,
      probability: 60,
      status: 'open',
      source: 'whatsapp',
      notes: JSON.stringify({ text: null, interest: 'Tienda online con pasarela de pagos', nextAction: 'Enviar propuesta ajustada', nextActionDate: daysFromNow(2).toISOString().slice(0, 10) }),
    },
  })
  await db.opportunity.create({
    data: {
      organizationId: orgId,
      title: 'Plan de consultoría mensual',
      clientId: jorge.id,
      stageId: nuevo?.id ?? null,
      amount: 1200,
      probability: 20,
      status: 'open',
      source: 'referral',
      notes: JSON.stringify({ text: null, interest: 'Acompañamiento estratégico', nextAction: 'Llamar para agendar reunión', nextActionDate: daysFromNow(1).toISOString().slice(0, 10) }),
    },
  })

  // Cotización
  const items = [
    { sku: 'WEB-CORP', description: 'Diseño y desarrollo de sitio web corporativo', quantity: 1, unitPrice: 2500 },
    { sku: 'HOST-AN', description: 'Hosting y mantenimiento anual', quantity: 1, unitPrice: 300 },
  ]
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const base = subtotal * 0.9 // 10% descuento
  const tax = base * 0.16
  await db.quote.create({
    data: {
      organizationId: orgId,
      number: 'COT-0001',
      clientId: maria.id,
      opportunityId: opp1.id,
      items: {
        create: items.map((it, idx) => ({
          sku: it.sku,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.quantity * it.unitPrice,
          position: idx,
        })),
      },
      subtotal,
      tax,
      total: base + tax,
      status: 'sent',
      validUntil: daysFromNow(15),
      notes: 'Incluye 2 rondas de revisión y capacitación del equipo.',
    },
  })

  // Reserva próxima
  await db.reservation.create({
    data: {
      organizationId: orgId,
      clientId: maria.id,
      title: 'Reunión de presentación de propuesta',
      description: JSON.stringify({ text: null, serviceType: 'virtual', notes: 'Preparar mockups y cronograma.' }),
      startsAt: daysFromNow(3, 10),
      endsAt: daysFromNow(3, 11),
      status: 'confirmed',
      location: 'Videollamada (Zoom)',
    },
  })

  // Transacciones de los últimos 6 meses (tendencia de ingresos)
  const monthlyIncomes = [1500, 2200, 1800, 2600, 3100, 2400]
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i, 5)
    d.setHours(12, 0, 0, 0)
    await db.transaction.create({
      data: {
        organizationId: orgId,
        type: 'ingreso',
        category: 'venta',
        description: `Pagos de clientes — ${d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}`,
        amount: monthlyIncomes[5 - i],
        date: d,
        clientId: i % 2 === 0 ? maria.id : carlos.id,
        method: 'transferencia',
      },
    })
  }
  const expenses: Array<{ amount: number; category: string; description: string; monthsAgo: number }> = [
    { amount: 45, category: 'operacion', description: 'Suscripción de software CRM', monthsAgo: 4 },
    { amount: 650, category: 'operacion', description: 'Compra de equipo de cómputo', monthsAgo: 3 },
    { amount: 180, category: 'marketing', description: 'Campaña Meta Ads', monthsAgo: 2 },
    { amount: 60, category: 'nomina', description: 'Freelance de diseño', monthsAgo: 0 },
  ]
  for (const e of expenses) {
    const d = new Date()
    d.setMonth(d.getMonth() - e.monthsAgo, 12)
    d.setHours(12, 0, 0, 0)
    await db.transaction.create({
      data: { organizationId: orgId, type: 'egreso', category: e.category, description: e.description, amount: e.amount, date: d },
    })
  }

  // Plantillas
  await db.template.createMany({
    data: [
      {
        organizationId: orgId,
        name: 'Seguimiento post-venta',
        category: 'seguimiento',
        channel: 'whatsapp',
        body: 'Hola {{name}}, ¿qué tal va todo con {{service}}? Cualquier cosa que necesites, estoy para ayudarte. ¡Un saludo!',
        variables: JSON.stringify(['name', 'service']),
      },
      {
        organizationId: orgId,
        name: 'Confirmación de cita',
        category: 'confirmacion',
        channel: 'generic',
        body: 'Hola {{name}}, te confirmo nuestra cita del {{date}}. Si necesitas reprogramar, avísame con anticipación. ¡Te esperamos!',
        variables: JSON.stringify(['name', 'date']),
      },
    ],
  })

  // Automatizaciones de ejemplo (inactivas)
  await db.automation.createMany({
    data: [
      {
        organizationId: orgId,
        name: 'Bienvenida a nuevos clientes',
        category: 'seguimiento',
        description: 'Envía un mensaje de bienvenida por WhatsApp cuando se crea un cliente.',
        triggerType: 'client_created',
        triggerConfig: JSON.stringify({ channel: 'whatsapp' }),
        actions: JSON.stringify([
          { type: 'send_whatsapp', config: { body: '¡Bienvenido {{name}}! Gracias por confiar en nosotros. Te contactaremos muy pronto.' } },
        ]),
        isActive: false,
      },
      {
        organizationId: orgId,
        name: 'Aviso de oportunidad en Oferta',
        category: 'custom',
        description: 'Notifica al admin cuando una oportunidad llega a la etapa Oferta.',
        triggerType: 'opportunity_stage_changed',
        conditions: JSON.stringify([{ field: 'toStage', operator: 'equals', value: 'Oferta' }]),
        actions: JSON.stringify([
          { type: 'notify_admin', config: { title: 'Oportunidad en etapa Oferta', body: '{{title}} ({{amount}}) pasó a Oferta.' } },
        ]),
        isActive: false,
      },
      {
        organizationId: orgId,
        name: 'Preparación de reuniones',
        category: 'confirmacion',
        description: 'Crea un recordatorio interno cuando se agenda una reserva.',
        triggerType: 'reservation_created',
        actions: JSON.stringify([
          { type: 'create_task_like_notification', config: { title: 'Preparar reunión con {{clientName}}', body: 'Reserva: {{title}}' } },
        ]),
        isActive: false,
      },
      {
        organizationId: orgId,
        name: 'Secuencia post-venta',
        category: 'seguimiento',
        description: 'Tras ganar una oportunidad: check-in de satisfacción por WhatsApp al día 3 y seguimiento IA con pedido de reseña al día 7.',
        triggerType: 'opportunity_stage_changed',
        conditions: JSON.stringify([{ field: 'toStage', operator: 'equals', value: 'Cierre Ganado' }]),
        actions: JSON.stringify([
          { type: 'wait', config: { days: 3 } },
          { type: 'send_whatsapp', config: { body: 'Hola {{clientName}}, ¿qué tal va todo con {{title}}? Queremos asegurarnos de que quedes 100% satisfecho con el resultado. Cualquier cosa que necesites, nos cuentas.' } },
          { type: 'wait', config: { days: 4 } },
          { type: 'ai_followup', config: { instruction: 'Redacta un mensaje corto y cordial que agradezca la confianza y pida una reseña o recomendación tras cerrar el servicio. Si percibes insatisfacción en el historial, ofrece en su lugar una llamada de seguimiento.' } },
        ]),
        isActive: true,
      },
    ],
  })

  // Base de conocimiento del Agente IA
  await db.knowledge.createMany({
    data: [
      {
        organizationId: orgId,
        title: 'Catálogo de servicios y precios',
        category: 'catalogo',
        content:
          'Nuestro producto estrella es la Consultoría CRM ALBRA (precio: $2,500). También ofrecemos auditorías de datos por $1,200 y desarrollo de sitios web corporativos desde $2,000. El hosting y mantenimiento anual cuesta $300.',
        isActive: true,
      },
      {
        organizationId: orgId,
        title: 'Términos y condiciones',
        category: 'terminos',
        content:
          'Los pagos se realizan vía transferencia o link de pago. Tenemos garantía de 12 meses en todos nuestros productos tecnológicos. Las revisiones están incluidas según el alcance acordado en cada cotización.',
        isActive: true,
      },
    ],
  })

  // Timeline inicial para que "Actividad Reciente" tenga contenido
  await db.timelineEvent.createMany({
    data: [
      { organizationId: orgId, clientId: maria.id, opportunityId: opp1.id, type: 'whatsapp', title: 'WhatsApp enviado a María González', description: 'Propuesta inicial enviada con alcance y precios.', source: 'manual' },
      { organizationId: orgId, clientId: carlos.id, type: 'call', title: 'Llamada de descubrimiento', description: 'Interesado en automatizar la facturación mensual.', source: 'manual' },
      { organizationId: orgId, clientId: maria.id, type: 'quote', title: 'Cotización COT-0001 enviada', description: 'Sitio web corporativo + hosting anual.', source: 'manual' },
      { organizationId: orgId, clientId: jorge.id, type: 'note', title: 'Notas de la reunión', description: 'Evalúa presupuesto de consultoría para Q3.', source: 'manual' },
    ],
  })

  await db.activityLog.create({
    data: {
      organizationId: orgId,
      action: 'created',
      entity: 'client',
      entityId: maria.id,
      details: JSON.stringify({ name: 'María González' }),
    },
  })
}
