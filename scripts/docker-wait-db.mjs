#!/usr/bin/env node
/**
 * CRM ALBRA — Espera de esquema para Docker (helper del entrypoint).
 *
 * Verifica que la BD SQLite ya tenga el esquema del CRM (tabla Organization).
 * La usa scripts/docker-entrypoint.sh en el rol "daemon" para no abrir con
 * better-sqlite3 una BD vacía si arranca antes que `app` (p. ej. con
 * `docker run` manual; en Compose lo garantiza depends_on service_healthy).
 *
 * Exit 0 → esquema listo · Exit 1 → aún no (el entrypoint reintenta 90s).
 */
import Database from 'better-sqlite3'

// Misma lógica que el daemon: DATABASE_URL absoluto gana; default del contenedor.
const file = (process.env.DATABASE_URL || 'file:/app/db/custom.db').replace(/^file:/, '')

try {
  // fileMustExist: si la BD aún no existe → throw → exit 1 (sin crearla)
  const db = new Database(file, { fileMustExist: true })
  const row = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'Organization'")
    .get()
  db.close()
  process.exit(row && row.c > 0 ? 0 : 1)
} catch {
  process.exit(1)
}
