import 'dotenv/config'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { FIX } from './seed-data'

/**
 * Setup global de la batería Vitest (corre antes de CADA archivo de test).
 *
 * 1. Carga .env real (Vitest NO lo carga como Next.js) para APP_SECRET,
 *    APP_ENCRYPTION_KEY e INTERNAL_API_SECRET. Los valores nunca se imprimen.
 * 2. Redirige DATABASE_URL a una BD de prueba EFÍMERA (db/test-vitest.db).
 *    La BD viva (db/custom.db) jamás se abre aquí.
 * 3. Recrea el schema con `prisma db push --skip-generate` (el cliente Prisma
 *    ya generado en node_modules sirve porque es el mismo schema).
 * 4. Siembra el mínimo multi-tenant: 3 organizaciones, 2 usuarios, clientes,
 *    transacciones y knowledge.
 * 5. Blindaje de efectos secundarios: mock del motor de workflows para que
 *    ningún test pueda disparar email/Telegram/WhatsApp reales.
 */

// ---------- 1) Secretos (mismo contrato fail-fast que src/lib/auth.ts) ----------
if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 24) {
  throw new Error(
    '[tests] APP_SECRET ausente o demasiado corto (<24). La batería no arranca sin un .env válido (sin fallbacks, por seguridad).'
  )
}
if (!process.env.APP_ENCRYPTION_KEY) {
  throw new Error('[tests] APP_ENCRYPTION_KEY ausente en el entorno. Reviza .env.')
}

// ---------- 2) BD de prueba efímera ----------
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url)) // tests/setup
const PROJECT_ROOT = path.resolve(THIS_DIR, '..', '..')
const TEST_DB_PATH = path.join(PROJECT_ROOT, 'db', 'test-vitest.db')
const TEST_DB_URL = `file:${TEST_DB_PATH}`

// NODE_ENV ya es 'test' bajo Vitest → Prisma sin log de queries (ver src/lib/db.ts).
process.env.DATABASE_URL = TEST_DB_URL

for (const suffix of ['', '-journal', '-wal', '-shm']) {
  fs.rmSync(TEST_DB_PATH + suffix, { force: true })
}

try {
  execSync('npx prisma db push --skip-generate', {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  })
} catch (err) {
  const detail =
    err && typeof err === 'object' && 'stderr' in err
      ? String((err as { stderr: Buffer }).stderr)
      : err instanceof Error
        ? err.message
        : String(err)
  throw new Error('[tests] prisma db push falló contra la BD de prueba: ' + detail)
}

// ---------- 3) Semilla multi-tenant mínima ----------
const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL })

async function seed(): Promise<void> {
  await prisma.$transaction([
    prisma.organization.createMany({
      data: [FIX.orgA, FIX.orgB, FIX.orgC],
    }),
    prisma.user.createMany({
      data: [FIX.userA, FIX.userB],
    }),
    prisma.client.createMany({
      data: [FIX.clientA1, FIX.clientA2, FIX.clientB1],
    }),
    prisma.transaction.createMany({
      data: [FIX.txIngreso1, FIX.txIngreso2, FIX.txEgreso1, FIX.txIncomeEnglish, FIX.txOrgB].map((tx) => ({
        ...tx,
        date: new Date(),
      })),
    }),
    prisma.knowledge.createMany({
      data: [FIX.knowledgeA1, FIX.knowledgeA2, FIX.knowledgeA3, FIX.knowledgeB1],
    }),
  ])
}

try {
  await seed()
} finally {
  await prisma.$disconnect()
}

// ---------- 4) Blindaje de canales externos ----------
// Ningún test debe poder enviar email/Telegram/WhatsApp reales ni hablar con
// el daemon: el motor de workflows queda no-op durante toda la batería.
vi.mock('@/lib/workflow-engine', () => ({
  runWorkflowsForTrigger: vi.fn(async () => []),
}))
