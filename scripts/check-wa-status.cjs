// Verifica estado E2E de WhatsApp: daemon + mensajes en DB + config IA
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.whatsAppMessage.count();
  const latest = await prisma.whatsAppMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      id: true, direction: true, senderType: true, text: true,
      fromNumber: true, toNumber: true, isRead: true, createdAt: true,
      organizationId: true, conversationId: true,
    },
  });
  console.log('=== WhatsAppMessage total:', total, '===');
  for (const m of latest) {
    const dt = m.createdAt ? new Date(m.createdAt).toISOString() : '?';
    console.log(`[${dt}] ${m.direction}/${m.senderType} read=${m.isRead} org=${(m.organizationId||'').slice(0,8)} conv=${(m.conversationId||'').slice(0,10)} from=${(m.fromNumber||'').slice(0,15)} :: ${(m.text||'').slice(0,60).replace(/\n/g,' ')}`);
  }

  // Config IA de la org (NichoConfig)
  const orgs = await prisma.organization.findMany({ take: 3, select: { id: true, name: true } });
  for (const o of orgs) {
    const cfg = await prisma.nichoConfig.findUnique({ where: { organizationId: o.id } }).catch(() => null);
    const kn = await prisma.knowledge.count({ where: { organizationId: o.id, isActive: true } }).catch(() => -1);
    const convs = await prisma.whatsAppConversation.count({ where: { organizationId: o.id } }).catch(() => -1);
    console.log(`--- Org ${o.name} (${o.id.slice(0,8)}): autoReply=${cfg ? cfg.autoReplyEnabled : '?'} rubro=${cfg ? cfg.rubro : '?'} knowledge=${kn} waConvs=${convs}`);
  }

  // Clientes con teléfono de WA activo
  const cliCount = await prisma.client.count();
  console.log('=== Clientes totales:', cliCount, '===');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
