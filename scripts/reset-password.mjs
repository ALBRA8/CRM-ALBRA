/**
 * Reseteo de contraseña por consola (vía oficial cuando no hay email
 * configurado para el flujo de reset). Usa EXACTAMENTE el mismo esquema
 * scrypt que src/lib/auth.ts (scrypt:salt:hash, 64 bytes).
 *
 * Uso (desde la raíz del CRM):
 *   node --env-file=.env scripts/reset-password.mjs <email> <nueva-clave>
 *
 * Deja registro en la bitácora de la organización del usuario.
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) {
    console.error('[reset-password] Uso: node --env-file=.env scripts/reset-password.mjs <email> <nueva-clave>')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('[reset-password] La clave debe tener al menos 8 caracteres.')
    process.exit(1)
  }

  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (!user) {
    console.error(`[reset-password] No existe ningún usuario con el email "${email}".`)
    process.exit(1)
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(password), resetToken: null, resetTokenExp: null },
  })

  await db.activityLog.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      action: 'updated',
      entity: 'user',
      entityId: user.id,
      details: JSON.stringify({ passwordReset: true, via: 'scripts/reset-password.mjs' }),
    },
  })

  console.log(`[reset-password] OK: la clave de ${user.email} fue restablecida (rol: ${user.role}).`)
  console.log('[reset-password] Ninguna sesión activa se revoca: si había sesión abierta sigue válida hasta expirar.')
}

main()
  .catch((err) => {
    console.error('[reset-password] Error:', err.message)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
