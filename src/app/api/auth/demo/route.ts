import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, createToken } from '@/lib/auth';
import { seedNewUser } from '@/lib/seed';

// POST /api/auth/demo - Quick demo access without registration
export async function POST() {
  try {
    // Check if demo user already exists
    const existingUser = await db.user.findUnique({
      where: { email: 'demo@crmalbra.com' },
    });

    if (existingUser) {
      const token = await createToken({
        userId: existingUser.id,
        email: existingUser.email,
      });

      return NextResponse.json({
        token,
        user: {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          company: existingUser.company,
          phone: existingUser.phone,
          role: existingUser.role,
        },
      });
    }

    // Create demo user
    const hashedPassword = await hashPassword('demo123456');
    const user = await db.user.create({
      data: {
        name: 'Usuario Demo',
        email: 'demo@crmalbra.com',
        password: hashedPassword,
        company: 'Empresa Demo S.A.S',
        phone: '+57 300 123 4567',
        role: 'owner',
        isActive: true,
      },
    });

    // Seed default data
    await seedNewUser(user.id);

    // Seed demo data
    const stages = await db.pipelineStage.findMany({
      where: { userId: user.id },
      orderBy: { order: 'asc' },
    });

    // Create demo clients
    const clients = await Promise.all([
      db.client.create({
        data: {
          userId: user.id, name: 'María González', email: 'maria@gmail.com',
          phone: '+57 301 234 5678', identifier: '1098765432', company: 'González & Asociados',
          city: 'Bogotá', source: 'web', tags: '["VIP", "Recurrente"]',
          score: 85, temperature: 'Fuego', lastContactAt: new Date(),
        },
      }),
      db.client.create({
        data: {
          userId: user.id, name: 'Carlos Mendoza', email: 'carlos@empresa.com',
          phone: '+57 302 345 6789', identifier: '1098765433', company: 'Mendoza Tech',
          city: 'Medellín', source: 'referral', tags: '["Tecnología"]',
          score: 65, temperature: 'Caliente',
          lastContactAt: new Date(Date.now() - 3 * 86400000),
        },
      }),
      db.client.create({
        data: {
          userId: user.id, name: 'Ana Rodríguez', email: 'ana@rodri.co',
          phone: '+57 303 456 7890', city: 'Cali', source: 'whatsapp',
          tags: '["Nueva"]', score: 40, temperature: 'Tibio',
          lastContactAt: new Date(Date.now() - 7 * 86400000),
        },
      }),
      db.client.create({
        data: {
          userId: user.id, name: 'Pedro Jiménez', email: 'pedro@jimenez.com',
          phone: '+57 304 567 8901', identifier: '1098765435', company: 'Jiménez Group',
          city: 'Barranquilla', source: 'manual', tags: '["Corporativo"]',
          score: 20, temperature: 'Frío',
          lastContactAt: new Date(Date.now() - 30 * 86400000),
        },
      }),
      db.client.create({
        data: {
          userId: user.id, name: 'Laura Sánchez', email: 'laura@sanchez.co',
          phone: '+57 305 678 9012', identifier: '1098765436', company: 'Sánchez Legal',
          city: 'Bucaramanga', source: 'web', tags: '["Legal", "VIP"]',
          score: 72, temperature: 'Caliente',
          lastContactAt: new Date(Date.now() - 2 * 86400000),
        },
      }),
      db.client.create({
        data: {
          userId: user.id, name: 'Roberto Díaz', email: 'roberto@diaz.io',
          phone: '+57 306 789 0123', city: 'Cartagena', source: 'telegram',
          tags: '["Startup"]', score: 55, temperature: 'Tibio',
          lastContactAt: new Date(Date.now() - 14 * 86400000),
        },
      }),
    ]);

    // Create demo opportunities
    await Promise.all([
      db.opportunity.create({
        data: {
          userId: user.id, clientId: clients[0].id, stageId: stages[3].id,
          title: 'Consultoría Integral González', interest: 'Plan Premium de Consultoría',
          estimatedValue: 2500, probability: 75,
          nextAction: 'Llamar para confirmar decisión',
          nextActionDate: new Date(Date.now() + 2 * 86400000),
        },
      }),
      db.opportunity.create({
        data: {
          userId: user.id, clientId: clients[1].id, stageId: stages[2].id,
          title: 'Implementación Mendoza Tech', interest: 'Auditoría completa + Plan Básico',
          estimatedValue: 1800, probability: 60,
          nextAction: 'Enviar cotización formal',
          nextActionDate: new Date(Date.now() + 86400000),
        },
      }),
      db.opportunity.create({
        data: {
          userId: user.id, clientId: clients[2].id, stageId: stages[1].id,
          title: 'Servicios Ana Rodríguez', interest: 'Consultoría Inicial',
          estimatedValue: 450, probability: 40,
        },
      }),
      db.opportunity.create({
        data: {
          userId: user.id, clientId: clients[4].id, stageId: stages[0].id,
          title: 'Asesoría Legal Sánchez', interest: 'Auditoría Completa',
          estimatedValue: 3200, probability: 20,
        },
      }),
      db.opportunity.create({
        data: {
          userId: user.id, clientId: clients[5].id, stageId: stages[1].id,
          title: 'Startup Díaz - MVP', interest: 'Plan Básico mensual',
          estimatedValue: 899, probability: 50,
        },
      }),
      db.opportunity.create({
        data: {
          userId: user.id, clientId: clients[3].id, stageId: stages[4].id,
          title: 'Contrato Jiménez Group', interest: 'Consultoría Corporativa',
          estimatedValue: 5000, actualValue: 4500, probability: 100,
          closedAt: new Date(Date.now() - 5 * 86400000),
        },
      }),
    ]);

    // Create demo reservations
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const in3Days = new Date(); in3Days.setDate(in3Days.getDate() + 3);
    in3Days.setHours(14, 30, 0, 0);
    const in5Days = new Date(); in5Days.setDate(in5Days.getDate() + 5);
    in5Days.setHours(9, 0, 0, 0);

    await Promise.all([
      db.reservation.create({
        data: {
          userId: user.id, clientId: clients[0].id,
          title: 'Sesión de Seguimiento - María', serviceType: 'Consultoría',
          date: tomorrow, duration: 60, status: 'confirmed',
          location: 'Oficina Principal - Sala 3',
        },
      }),
      db.reservation.create({
        data: {
          userId: user.id, clientId: clients[1].id,
          title: 'Presentación de Propuesta - Carlos', serviceType: 'Auditoría',
          date: in3Days, duration: 90, status: 'confirmed',
          location: 'Virtual - Zoom',
        },
      }),
      db.reservation.create({
        data: {
          userId: user.id, clientId: clients[4].id,
          title: 'Consultoría Inicial - Laura', serviceType: 'Consultoría',
          date: in5Days, duration: 60, status: 'confirmed',
          location: 'Oficina Principal - Sala 1',
        },
      }),
    ]);

    // Create demo transactions
    await Promise.all([
      db.transaction.create({
        data: { userId: user.id, type: 'ingreso', amount: 4500, category: 'Servicio',
          description: 'Contrato Corporativo - Jiménez Group',
          date: new Date(Date.now() - 5 * 86400000) },
      }),
      db.transaction.create({
        data: { userId: user.id, type: 'ingreso', amount: 599, category: 'Suscripción',
          description: 'Plan Premium - María González (Renovación)',
          date: new Date(Date.now() - 12 * 86400000) },
      }),
      db.transaction.create({
        data: { userId: user.id, type: 'ingreso', amount: 299, category: 'Suscripción',
          description: 'Plan Básico - Roberto Díaz',
          date: new Date(Date.now() - 20 * 86400000) },
      }),
      db.transaction.create({
        data: { userId: user.id, type: 'egreso', amount: 350, category: 'Operación',
          description: 'Licencia de software mensual',
          date: new Date(Date.now() - 15 * 86400000) },
      }),
      db.transaction.create({
        data: { userId: user.id, type: 'egreso', amount: 200, category: 'Marketing',
          description: 'Campaña digital Google Ads',
          date: new Date(Date.now() - 25 * 86400000) },
      }),
      db.transaction.create({
        data: { userId: user.id, type: 'ingreso', amount: 1800, category: 'Servicio',
          description: 'Auditoría Q1 - Cliente Corporativo',
          date: new Date(Date.now() - 45 * 86400000) },
      }),
      db.transaction.create({
        data: { userId: user.id, type: 'ingreso', amount: 1200, category: 'Servicio',
          description: 'Consultoría Q1 - Varios clientes',
          date: new Date(Date.now() - 75 * 86400000) },
      }),
      db.transaction.create({
        data: { userId: user.id, type: 'ingreso', amount: 2200, category: 'Suscripción',
          description: 'Suscripciones Q1 - Renovaciones',
          date: new Date(Date.now() - 105 * 86400000) },
      }),
    ]);

    // Create demo quote
    await db.quote.create({
      data: {
        userId: user.id, clientId: clients[1].id, quoteNumber: 'COT-2024-001',
        status: 'sent', subtotal: 1747, discount: 0, tax: 332, total: 2079,
        validUntil: new Date(Date.now() + 30 * 86400000),
        items: {
          create: [
            { sku: 'AUD-001', description: 'Auditoría Completa', quantity: 1, unitPrice: 500, subtotal: 500 },
            { sku: 'SUB-002', description: 'Plan Básico (3 meses)', quantity: 3, unitPrice: 299, subtotal: 897 },
            { sku: 'CON-004', description: 'Sesión de Seguimiento', quantity: 2, unitPrice: 100, subtotal: 200 },
            { sku: 'CON-001', description: 'Consultoría Inicial', quantity: 1, unitPrice: 150, subtotal: 150 },
          ],
        },
      },
    });

    // Create demo service history
    await Promise.all([
      db.clientServiceHistory.create({
        data: { clientId: clients[0].id, serviceType: 'Consultoría',
          description: 'Sesión de planificación estratégica', amount: 599,
          date: new Date(Date.now() - 15 * 86400000) },
      }),
      db.clientServiceHistory.create({
        data: { clientId: clients[0].id, serviceType: 'Auditoría',
          description: 'Auditoría de procesos Q1', amount: 500,
          date: new Date(Date.now() - 45 * 86400000) },
      }),
      db.clientServiceHistory.create({
        data: { clientId: clients[3].id, serviceType: 'Consultoría Corporativa',
          description: 'Contrato mensual de asesoría', amount: 4500,
          date: new Date(Date.now() - 5 * 86400000) },
      }),
    ]);

    // Create demo preferences
    await Promise.all([
      db.clientPreference.create({
        data: { clientId: clients[0].id, category: 'communication', key: 'channel', value: 'WhatsApp' },
      }),
      db.clientPreference.create({
        data: { clientId: clients[0].id, category: 'schedule', key: 'preferred_time', value: 'Mañana (9-12)' },
      }),
      db.clientPreference.create({
        data: { clientId: clients[1].id, category: 'communication', key: 'channel', value: 'Email' },
      }),
    ]);

    const token = await createToken({
      userId: user.id,
      email: user.email,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company: user.company,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Demo setup error:', error);
    return NextResponse.json(
      { error: 'Error al configurar demo' },
      { status: 500 }
    );
  }
}
