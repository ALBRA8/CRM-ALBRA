// ============================================================
// CRM ALBRA — Snapshot consistente de SQLite (corre DENTRO del contenedor)
//
// Uso (desde el HOST, vía scripts/backup-nightly.sh):
//   docker exec -i crm-albra-app node - < scripts/sqlite-backup.cjs
//
// Por qué así: copiar custom.db con `cp` mientras la app escribe puede
// atrapar la BD a mitad de una transacción (riesgo de corrupción). En su
// lugar usamos la Online Backup API de SQLite vía better-sqlite3 (ya está
// en la imagen, la usa el daemon): produce un snapshot consistente SIN
// detener la app ni el daemon, y además corre PRAGMA integrity_check
// sobre el resultado para que un backup silenciosamente dañado NO pase
// desapercibido.
//
// Config (opcional, env):
//   DATABASE_URL  → default file:/app/db/custom.db (la pisa compose)
//   BACKUP_OUT    → destino del snapshot (default /tmp/.backup-snapshot.db)
// Exit codes: 0 OK · 1 fallo del snapshot · 2 snapshot con integridad dudosa
// ============================================================

const Database = require('better-sqlite3')

const src = (process.env.DATABASE_URL || 'file:/app/db/custom.db').replace(/^file:/, '')
const out = process.env.BACKUP_OUT || '/tmp/.backup-snapshot.db'

const db = new Database(src)

db.backup(out)
  .then(() => {
    db.close()
    // Verificación del producto: un backup que no abre limpio NO es backup.
    const snap = new Database(out, { readonly: true })
    const check = snap.pragma('integrity_check', { simple: true })
    snap.close()
    if (check !== 'ok') {
      console.error(`[backup] FALLO integridad del snapshot (${out}): ${check}`)
      process.exit(2)
    }
    console.log(`[backup] snapshot consistente OK (${out}) — integrity_check: ok`)
    process.exit(0)
  })
  .catch((e) => {
    console.error('[backup] FALLO snapshot:', (e && e.message) || e)
    process.exit(1)
  })
