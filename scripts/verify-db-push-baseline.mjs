#!/usr/bin/env node
/**
 * verify-db-push-baseline.mjs — (hallazgo Antigravity 2026-11-26) demuestra y
 * prueba el PROCEDIMIENTO de adopción de migraciones para una base creada con
 * `prisma db push` (sin `_prisma_migrations`), sobre COPIAS efímeras.
 *
 * Ejecuta el motor REAL de Prisma CLI (node_modules/prisma/build/index.js vía
 * process.execPath — sin node_modules/.bin, multiplataforma Windows/Linux) y
 * verifica las 3 situaciones problemáticas:
 *
 *   Escenario 1 — db push al ESQUEMA VIGENTE (sin tablas legacy, con los
 *   índices ya creados: Quote_opportunityId_idx, índices de Task):
 *   baseline con `migrate resolve --applied` para toda la cadena menos la
 *   última + `migrate deploy` → la migración destructiva v3 corre como no-op
 *   limpio (sombras + IF EXISTS/IF NOT EXISTS) y preserva las filas de Task.
 *
 *   Escenario 2 — db push SIN la tabla Task (anterior a `zzzzzzzz_tareas`):
 *   la migración destructiva ya NO depende de que Task exista (sombra) y
 *   deja Task con la forma vigente.
 *
 *   Escenario 3 — db push con DATOS LEGACY reales (blobs v1:iv:tag:datos):
 *   baseline + deploy → backfill SQL migra a las tablas canónicas, blobs
 *   byte a byte, integridad limpia.
 *
 * Uso:  node scripts/verify-db-push-baseline.mjs
 * Exit: 0 si los 3 escenarios pasan; 1 en cuanto uno falla.
 * Seguridad: solo datos sintéticos; jamás imprime secretos ni tokens.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRISMA_BIN = path.join(REPO, 'node_modules', 'prisma', 'build', 'index.js')
const MIGRATIONS_DIR = path.join(REPO, 'prisma', 'migrations')

const results = []
function check(id, label, ok, detail = '') {
  results.push({ id, ok: Boolean(ok) })
  console.log(`${ok ? '✅' : '❌'} [${id}] ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Orden lexicográfico de migraciones, igual que Prisma. */
function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** Blob cifrado en el formato de encryptSecret: v1:iv:tag:datos (NO JSON). */
function v1Blob() {
  return `v1:${randomBytes(12).toString('base64')}:${randomBytes(16).toString('base64')}:${randomBytes(48).toString('base64')}`
}

/** Prisma CLI con DATABASE_URL absoluta (barras forward: válido también en
 *  Windows) y cwd en el repo, donde vive prisma/schema.prisma. */
function prisma(args, dbPath) {
  const res = spawnSync(process.execPath, [PRISMA_BIN, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, DATABASE_URL: `file:${dbPath.replace(/\\/g, '/')}` },
  })
  const out = `${res.stdout || ''}${res.stderr || ''}`
  return { ok: res.status === 0, out }
}

/** Baseline: marca como aplicadas las migraciones [0..hasta) SIN ejecutarlas. */
function baselineResolve(dbPath, migrations, hasta) {
  for (const name of migrations.slice(0, hasta)) {
    const r = prisma(['migrate', 'resolve', '--applied', name], dbPath)
    if (!r.ok) throw new Error(`resolve --applied ${name} falló:\n${r.out.slice(-600)}`)
  }
}

/** Construye la BD con la cadena [0..hasta) ejecutando el SQL REAL. */
function buildChainDb(dbPath, migrations, hasta) {
  const db = new DatabaseSync(dbPath)
  for (const name of migrations.slice(0, hasta)) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'))
  }
  return db
}

function tableExists(db, name) {
  const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)
  return Boolean(row)
}

function indexExists(db, name) {
  const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`).get(name)
  return Boolean(row)
}

function integrity(db) {
  const ic = db.prepare('PRAGMA integrity_check').get().integrity_check
  const fk = db.prepare('PRAGMA foreign_key_check').all()
  return { ic, fk }
}

function seedOrg(db, id, name, slug) {
  db.prepare(`INSERT INTO "Organization" ("id", "name", "slug", "updatedAt") VALUES (?, ?, ?, CURRENT_TIMESTAMP)`).run(id, name, slug)
}

function seedTask(db, id, orgId, title) {
  db.prepare(`INSERT INTO "Task" ("id", "organizationId", "title", "updatedAt") VALUES (?, ?, ?, CURRENT_TIMESTAMP)`).run(id, orgId, title)
}

// ——— Escenario 1: db push al esquema VIGENTE (sin legacy, índices presentes) ———
function escenario1(migrations, workdir) {
  console.log('\n— Escenario 1: db push al esquema VIGENTE (sin tablas legacy, con índices ya creados) —')
  const dir = fs.mkdtempSync(path.join(workdir, 's1-'))
  const dbName = 'baseline.db'
  const dbPath = path.join(dir, dbName)

  // Cadena hasta ANTES de la destructiva.
  const hasta = migrations.indexOf('zzzzzzzzz_drop_legacy_channel_models')
  const db = buildChainDb(dbPath, migrations, hasta)
  seedOrg(db, 'org_s1', 'Org S1', 'org-s1')
  seedTask(db, 'task_s1_1', 'org_s1', 'Tarea previa 1')
  seedTask(db, 'task_s1_2', 'org_s1', 'Tarea previa 2')
  // Emular `db push` al esquema vigente: los modelos legacy se quitaron del
  // schema.prisma → db push (con --accept-data-loss) dropeó las tablas; los
  // índices del esquema vigente (Quote_opportunityId_idx) ya existen.
  db.exec(`PRAGMA foreign_keys=off;
    DROP TABLE "WhatsAppMessage"; DROP TABLE "WhatsAppConversation";
    DROP TABLE "WhatsAppConnectionEvent"; DROP TABLE "WhatsAppConnection";
    DROP TABLE "Integration";
    CREATE INDEX "Quote_opportunityId_idx" ON "Quote"("opportunityId");
    PRAGMA foreign_keys=on;`)
  db.close()

  // Procedimiento documentado: baseline (resolve --applied de la cadena hasta
  // expand) + deploy (aplica SOLO zzzzzzzzz_drop_legacy_channel_models).
  const hastaExpand = migrations.indexOf('zzzzzzzz_canonical_channel_expand') + 1
  baselineResolve(dbPath, migrations, hastaExpand)
  const dep = prisma(['migrate', 'deploy'], dbPath)
  check('S1-deploy', 'migrate deploy aplica la destructiva sin abortar', dep.ok, dep.ok ? dep.out.split('\n').filter((l) => l.includes('migration')).join(' | ').slice(0, 160) : dep.out.slice(-300))

  const dbr = new DatabaseSync(dbPath)
  const legacy = ['Integration', 'WhatsAppConnection', 'WhatsAppConnectionEvent', 'WhatsAppConversation', 'WhatsAppMessage']
  check('S1-legacy', 'tablas legacy eliminadas', legacy.every((t) => !tableExists(dbr, t)))
  const tasks = dbr.prepare(`SELECT COUNT(*) AS n FROM "Task"`).get().n
  check('S1-task', 'filas de Task preservadas por el redefine', Number(tasks) === 2, `rows=${tasks}`)
  const taskSql = dbr.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='Task'`).get().sql
  check('S1-task-fk', 'Task con forma vigente (NOT NULL + ON UPDATE CASCADE)', /"organizationId" TEXT NOT NULL/.test(taskSql) && /ON UPDATE CASCADE/.test(taskSql))
  check('S1-idx-quote', 'Quote_opportunityId_idx presente (sin duplicar)', indexExists(dbr, 'Quote_opportunityId_idx'))
  check('S1-idx-task', 'índices de Task presentes', ['Task_organizationId_status_idx', 'Task_organizationId_dueAt_idx', 'Task_clientId_idx'].every((i) => indexExists(dbr, i)))
  const { ic, fk } = integrity(dbr)
  check('S1-integridad', 'integrity_check ok y foreign_key_check vacío', ic === 'ok' && fk.length === 0, `integrity=${ic} fk=${fk.length}`)
  dbr.close()
}

// ——— Escenario 2: db push SIN la tabla Task (anterior a zzzzzzzz_tareas) ———
function escenario2(migrations, workdir) {
  console.log('\n— Escenario 2: db push SIN la tabla Task (la migración no debe depender de que Task exista) —')
  const dir = fs.mkdtempSync(path.join(workdir, 's2-'))
  const dbName = 'baseline.db'
  const dbPath = path.join(dir, dbName)

  const hasta = migrations.indexOf('zzzzzzzzz_drop_legacy_channel_models')
  const db = buildChainDb(dbPath, migrations, hasta)
  seedOrg(db, 'org_s2', 'Org S2', 'org-s2')
  // Emular una db push anterior al módulo de tareas: sin Task ni sus índices.
  db.exec(`DROP TABLE "Task"`)
  db.close()

  const hastaExpand = migrations.indexOf('zzzzzzzz_canonical_channel_expand') + 1
  baselineResolve(dbPath, migrations, hastaExpand)
  const dep = prisma(['migrate', 'deploy'], dbPath)
  check('S2-deploy', 'migrate deploy OK sin la tabla Task', dep.ok, dep.ok ? '' : dep.out.slice(-300))

  const dbr = new DatabaseSync(dbPath)
  check('S2-task', 'Task RECREADA con la forma vigente', tableExists(dbr, 'Task'))
  const taskSql = dbr.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='Task'`).get().sql
  check('S2-task-fk', 'forma vigente (organizationId NOT NULL + CASCADE)', /"organizationId" TEXT NOT NULL/.test(taskSql) && /ON UPDATE CASCADE/.test(taskSql))
  check('S2-idx-task', 'índices de Task recreados', ['Task_organizationId_status_idx', 'Task_organizationId_dueAt_idx', 'Task_clientId_idx'].every((i) => indexExists(dbr, i)))
  const { ic, fk } = integrity(dbr)
  check('S2-integridad', 'integrity_check ok y foreign_key_check vacío', ic === 'ok' && fk.length === 0, `integrity=${ic} fk=${fk.length}`)
  dbr.close()
}

// ——— Escenario 3: db push con DATOS LEGACY reales (backfill por el CLI) ———
function escenario3(migrations, workdir) {
  console.log('\n— Escenario 3: db push con DATOS LEGACY (blobs v1:iv:tag:datos) — backfill por el CLI real —')
  const dir = fs.mkdtempSync(path.join(workdir, 's3-'))
  const dbName = 'baseline.db'
  const dbPath = path.join(dir, dbName)

  const hasta = migrations.indexOf('zzzzzzzzz_drop_legacy_channel_models')
  const db = buildChainDb(dbPath, migrations, hasta)
  seedOrg(db, 'org_s3', 'Org S3', 'org-s3')
  const TG = v1Blob()
  const TT = v1Blob()
  const FB = v1Blob()
  const WAC = v1Blob()
  db.prepare(`INSERT INTO "Integration" ("id", "organizationId", "telegramBotTokenEnc", "facebookTokenEnc", "facebookPageId", "tiktokTokenEnc", "enableTikTok", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`).run('int_s3', 'org_s3', TG, FB, '100000000000042', TT)
  db.prepare(`INSERT INTO "WhatsAppConnection" ("id", "organizationId", "wabaId", "phoneNumberId", "phoneNumber", "accessTokenEnc", "webhookVerifyToken", "status", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', CURRENT_TIMESTAMP)`).run('wac_s3', 'org_s3', '100000000000099', '100000000000098', '573000000042', WAC, 'verify_token_s3')
  db.close()

  const hastaExpand = migrations.indexOf('zzzzzzzz_canonical_channel_expand') + 1
  baselineResolve(dbPath, migrations, hastaExpand)
  const dep = prisma(['migrate', 'deploy'], dbPath)
  check('S3-deploy', 'migrate deploy con datos legacy OK', dep.ok, dep.ok ? '' : dep.out.slice(-300))

  const dbr = new DatabaseSync(dbPath)
  const legacy = ['Integration', 'WhatsAppConnection', 'WhatsAppConnectionEvent', 'WhatsAppConversation', 'WhatsAppMessage']
  check('S3-legacy', 'tablas legacy eliminadas tras el backfill', legacy.every((t) => !tableExists(dbr, t)))
  const conns = Number(dbr.prepare(`SELECT COUNT(*) AS n FROM "ChannelConnection"`).get().n)
  check('S3-conns', '4 conexiones canónicas creadas (wcloud, telegram, facebook, tiktok)', conns === 4, `conns=${conns}`)
  const wa = dbr.prepare(`SELECT credentialsEnc FROM "ChannelConnection" WHERE providerAccountKey=?`).get('meta:whatsapp:100000000000098')
  check('S3-blob-wa', 'blob WhatsApp Cloud copiado byte a byte', wa?.credentialsEnc === WAC)
  const tg = dbr.prepare(`SELECT credentialsEnc FROM "ChannelConnection" WHERE providerAccountKey=?`).get('telegram:org:org_s3')
  check('S3-blob-tg', 'blob Telegram copiado byte a byte (clave estable por org)', tg?.credentialsEnc === TG)
  const tt = dbr.prepare(`SELECT credentialsEnc FROM "ChannelConnection" WHERE providerAccountKey=?`).get('tiktok:business:org_s3')
  check('S3-blob-tt', 'blob TikTok copiado byte a byte (tiktok:business:<orgId>)', tt?.credentialsEnc === TT)
  const fb = dbr.prepare(`SELECT externalAccountId FROM "ChannelConnection" WHERE providerAccountKey=?`).get('meta:messenger:100000000000042')
  check('S3-fb', 'Facebook migrado por facebookPageId plano', fb?.externalAccountId === '100000000000042')
  const { ic, fk } = integrity(dbr)
  check('S3-integridad', 'integrity_check ok y foreign_key_check vacío', ic === 'ok' && fk.length === 0, `integrity=${ic} fk=${fk.length}`)
  dbr.close()
}

// ——— Main ———
function main() {
  console.log('=== VERIFICACIÓN DEL PROCEDIMIENTO db push → BASELINE (motor real de Prisma, sobre copias efímeras) ===')
  if (!fs.existsSync(PRISMA_BIN)) throw new Error('No se encontró el CLI de Prisma (¿npm install?)')
  const migrations = listMigrations()
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbpush-baseline-'))
  try {
    escenario1(migrations, workdir)
    escenario2(migrations, workdir)
    escenario3(migrations, workdir)
  } finally {
    try { fs.rmSync(workdir, { recursive: true, force: true }) } catch { /* el SO la limpiará */ }
  }
  const fails = results.filter((r) => !r.ok).length
  console.log(`\n=== PROCEDIMIENTO db push: ${results.length - fails}/${results.length} comprobaciones PASS ===`)
  process.exitCode = fails === 0 ? 0 : 1
}

main()
