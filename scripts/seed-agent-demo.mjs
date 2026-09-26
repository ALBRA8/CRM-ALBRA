// Crea (o actualiza) un usuario AGENTE de demostración en la organización demo
// para verificar la Fase 2 (RBAC) en vivo. Idempotente.
// Credenciales: agente@demo.albra / Agente1234
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

const prisma = new PrismaClient()
try {
  const demoOrg = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })
  if (!demoOrg) throw new Error('No hay organizaciones en la BD')
  const data = {
    email: 'agente@demo.albra',
    name: 'Agente Demo',
    passwordHash: hashPassword('Agente1234'),
    role: 'agent',
    organizationId: demoOrg.id,
    isActive: true,
  }
  const user = await prisma.user.upsert({
    where: { email: data.email },
    update: { passwordHash: data.passwordHash, role: 'agent', isActive: true, organizationId: demoOrg.id },
    create: data,
  })
  console.log('OK agente listo en org', demoOrg.id, demoOrg.name, '→ user', user.id)
} finally {
  await prisma.$disconnect()
}
