#!/usr/bin/env node
/**
 * db-guard.mjs — Protege operaciones de esquema en bases de datos reales.
 * En entornos protegidos exige ALLOW_DESTRUCTIVE_DB_OPERATION=true.
 * 'migrate' usa migrate deploy (nunca migrate dev); 'dev' queda separado.
 */
import { spawnSync } from 'node:child_process'

const action = process.argv[2] // 'push' | 'reset' | 'migrate'
const isProd = process.env.NODE_ENV === 'production'
const dbUrl = process.env.DATABASE_URL || ''
const isProdDb = /prod|production|amazonaws|neon\.tech|supabase|render|fly\.io/i.test(dbUrl)
const allowDestructive = process.env.ALLOW_DESTRUCTIVE_DB_OPERATION === 'true'

if ((isProd || isProdDb) && !allowDestructive) {
  console.error('⛔ Operación de base de datos bloqueada en entorno protegido.')
  console.error(`Acción: ${action}; NODE_ENV=${process.env.NODE_ENV}; DATABASE_URL configurada: ${Boolean(dbUrl)}`)
  console.error('Para autorizar explícitamente la operación, define ALLOW_DESTRUCTIVE_DB_OPERATION=true.')
  process.exit(1)
}

let prismaArgs
if (action === 'push') prismaArgs = ['db', 'push', '--accept-data-loss']
else if (action === 'reset') prismaArgs = ['migrate', 'reset']
else if (action === 'migrate') prismaArgs = ['migrate', 'deploy']
else {
  console.error(`[db-guard] Acción no reconocida: ${action}`)
  process.exit(1)
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const res = spawnSync(npx, ['prisma', ...prismaArgs], { stdio: 'inherit' })
if (res.error) {
  console.error(`[db-guard] No se pudo iniciar Prisma: ${res.error.message}`)
  process.exit(1)
}
process.exit(res.status ?? 1)
