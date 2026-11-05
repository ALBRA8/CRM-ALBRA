/**
 * Promoción a Super Admin (plano de control multi-organización).
 *
 * El rol `superadmin` NO puede crearse por API (ni /api/auth/register ni
 * /api/team lo ofrecen): solo existe por promoción directa en BD. Este script
 * es LA vía oficial y deja registro en la bitácora de la organización.
 *
 * Uso (desde la raíz del CRM):
 *   node --env-file=.env scripts/promote-superadmin.mjs [email]
 *
 * Sin email → promueve al primer usuario owner activo de la organización más
 * antigua (caso típico: dueño único de la plataforma).
 *
 * Si el email no existe → error sin cambios. Si el usuario ya es superadmin →
 * avisa y no repite la promoción.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()

  let user = null
  if (email) {
    user = await db.user.findUnique({ where: { email }, include: { organization: true } })
    if (!user) {
      console.error(`[promote-superadmin] No existe ningún usuario con el email "${email}". Nada cambiado.`)
      process.exit(1)
    }
  } else {
    // Caso dueño único: primer owner activo de la organización más antigua.
    const oldestOrg = await db.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      include: { users: { where: { role: 'owner', isActive: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    })
    user = oldestOrg?.users[0]
      ? await db.user.findUnique({ where: { id: oldestOrg.users[0].id }, include: { organization: true } })
      : null
    if (!user) {
      console.error('[promote-superadmin] No hay usuarios owner activos para promover. Pasa un email como argumento.')
      process.exit(1)
    }
  }

  if (user.role === 'superadmin') {
    console.log(`[promote-superadmin] ${user.email} ya es superadmin. Nada por hacer.`)
    return
  }

  const previousRole = user.role
  const updated = await db.user.update({ where: { id: user.id }, data: { role: 'superadmin' } })

  await db.activityLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: 'updated',
      entity: 'user',
      entityId: user.id,
      details: JSON.stringify({
        promotedTo: 'superadmin',
        previousRole,
        via: 'scripts/promote-superadmin.mjs',
      }),
    },
  })

  console.log(`[promote-superadmin] OK: ${updated.email} promovido de "${previousRole}" a "superadmin".`)
  console.log('[promote-superadmin] Cierra sesión y vuelve a entrar para que el nuevo JWT cargue el rol.')
}

main()
  .catch((err) => {
    console.error('[promote-superadmin] Error:', err.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
