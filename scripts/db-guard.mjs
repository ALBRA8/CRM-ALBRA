#!/usr/bin/env node
/**
 * db-guard.mjs — Protector de comandos destructivos de base de datos.
 *
 * Evita la ejecución accidental de comandos como:
 *  - prisma db push --accept-data-loss
 *  - prisma migrate reset
 * contra entornos productivos o bases de datos reales.
 */
import { spawnSync } from 'node:child_process'

const action = process.argv[2] // 'push' | 'reset' | 'migrate'
const isProd = process.env.NODE_ENV === 'production'
const dbUrl = process.env.DATABASE_URL || ''
const isProdDb = /prod|production|amazonaws|neon\.tech|supabase|render|fly\.io/i.test(dbUrl)
const allowDestructive = process.env.ALLOW_DESTRUCTIVE_DB_OPERATION === 'true'

if ((isProd || isProdDb) && !allowDestructive) {
  console.error('\n=============================================================')
  console.error('⛔ BLOQUEO DE SEGURIDAD DE BASE DE DATOS')
  console.error('=============================================================')
  console.error(`Se detectó un intento de ejecutar operación destructiva '${action}'`)
  console.error(`en un entorno protegido (NODE_ENV=${process.env.NODE_ENV}, DB_URL=${dbUrl.replace(/:[^:@]+@/, ':***@')}).`)
  console.error('Para prevenir pérdida irrecuperable de datos, esta acción ha sido abortada.')
  console.error('Si realmente necesitas ejecutar esto, define explícitamente:')
  console.error('  ALLOW_DESTRUCTIVE_DB_OPERATION=true')
  console.error('=============================================================\n')
  process.exit(1)
}

let prismaArgs = []
if (action === 'push') {
  prismaArgs = ['db', 'push', '--accept-data-loss']
} else if (action === 'reset') {
  prismaArgs = ['migrate', 'reset']
} else if (action === 'migrate') {
  prismaArgs = ['migrate', 'dev']
} else {
  console.error(`[db-guard] Acción no reconocida: ${action}`)
  process.exit(1)
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const res = spawnSync(npx, ['prisma', ...prismaArgs], { stdio: 'inherit' })
process.exit(res.status ?? 0)
