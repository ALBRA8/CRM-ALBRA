import { db } from '@/lib/db';

export async function createDefaultPipelineStages(userId: string): Promise<void> {
  const defaultStages = [
    { name: 'Prospección', order: 1, color: '#6b7280' },
    { name: 'Calificación', order: 2, color: '#3b82f6' },
    { name: 'Oferta', order: 3, color: '#f59e0b' },
    { name: 'Seguimiento', order: 4, color: '#8b5cf6' },
    { name: 'Cierre Ganado', order: 5, color: '#10b981' },
  ];

  for (const stage of defaultStages) {
    await db.pipelineStage.upsert({
      where: {
        userId_order: { userId, order: stage.order },
      },
      create: {
        userId,
        name: stage.name,
        order: stage.order,
        color: stage.color,
      },
      update: {
        name: stage.name,
        color: stage.color,
      },
    });
  }
}

export async function createSampleServices(userId: string): Promise<void> {
  const sampleServices = [
    {
      name: 'Consultoría Inicial',
      description: 'Sesión de consultoría para diagnóstico de necesidades',
      category: 'Consultoría',
      price: 150,
      duration: 60,
    },
    {
      name: 'Plan Básico',
      description: 'Paquete de servicios básicos mensuales',
      category: 'Suscripción',
      price: 299,
      duration: 30,
    },
    {
      name: 'Plan Premium',
      description: 'Paquete de servicios premium con soporte prioritario',
      category: 'Suscripción',
      price: 599,
      duration: 30,
    },
    {
      name: 'Sesión de Seguimiento',
      description: 'Sesión de seguimiento y revisión de avances',
      category: 'Consultoría',
      price: 100,
      duration: 45,
    },
    {
      name: 'Auditoría Completa',
      description: 'Auditoría integral del negocio con reporte detallado',
      category: 'Auditoría',
      price: 500,
      duration: 120,
    },
  ];

  for (const service of sampleServices) {
    await db.service.create({
      data: {
        userId,
        ...service,
      },
    });
  }
}

export async function createDefaultAutomations(userId: string): Promise<void> {
  const defaultAutomations = [
    {
      name: 'Recordatorio de Cita',
      type: 'reminder',
      trigger: 'before_appointment',
      conditions: JSON.stringify({ hoursBefore: 24 }),
      actions: JSON.stringify({ sendReminder: true, channel: 'whatsapp' }),
      message: 'Hola {nombre}, te recordamos que tienes una cita programada para mañana a las {hora}. ¡Te esperamos!',
      isActive: true,
    },
    {
      name: 'Recuperación de Inactivos',
      type: 'inactive_recovery',
      trigger: 'days_inactive',
      conditions: JSON.stringify({ daysInactive: 30 }),
      actions: JSON.stringify({ sendRecovery: true, channel: 'whatsapp' }),
      message: 'Hola {nombre}, hace tiempo que no nos contactas. ¿En qué podemos ayudarte? Tenemos novedades que podrían interesarte.',
      isActive: true,
    },
    {
      name: 'Seguimiento de Fidelización',
      type: 'loyalty',
      trigger: 'after_service',
      conditions: JSON.stringify({ daysAfterService: 7 }),
      actions: JSON.stringify({ sendFollowUp: true, channel: 'whatsapp' }),
      message: 'Hola {nombre}, esperamos que estés satisfecho con nuestro servicio. ¿Te gustaría agendar tu próxima cita o conocer nuestras promociones?',
      isActive: true,
    },
  ];

  for (const automation of defaultAutomations) {
    await db.automation.create({
      data: {
        userId,
        ...automation,
      },
    });
  }
}

export async function seedNewUser(userId: string): Promise<void> {
  await createDefaultPipelineStages(userId);
  await createSampleServices(userId);
  await createDefaultAutomations(userId);
}
