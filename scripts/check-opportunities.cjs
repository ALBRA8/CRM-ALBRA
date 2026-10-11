// Verifica los últimos Opportunities (para confirmar que la IA del WhatsApp creó uno)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const opps = await prisma.opportunity.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, title: true, stageId: true, amount: true, source: true, createdAt: true, clientId: true },
  });
  console.log('=== Últimos Opportunities ===');
  for (const o of opps) {
    console.log(`[${o.createdAt.toISOString()}] "${o.title}" | stage=${o.stageId.slice(0, 10)} valor=${o.amount} source=${o.source || 'N/A'} client=${(o.clientId || '').slice(0, 8)}`);
  }
  const count = await prisma.opportunity.count();
  console.log('Total oportunidades:', count);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
