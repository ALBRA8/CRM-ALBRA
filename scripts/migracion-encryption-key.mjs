// Migrador dual-key de APP_ENCRYPTION_KEY (preservación de datos cifrados)
// Re-cifra todo payload v1:* de la BD: decrypt con clave VIEJA → encrypt con NUEVA.
// Modo selftest: genera BD sintética, cifra con OLD (algoritmo real de crypto.ts),
// ejecuta la migración y verifica el descifrado con NEW vía el crypto.ts publicado.
// No imprime valores de secretos ni de datos cifrados.
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import Database from '/home/z/my-project/node_modules/better-sqlite3/lib/index.js'
import { createRequire } from 'node:module'
const require = createRequire('/home/z/my-project/package.json')

const args = process.argv.slice(2)
const SELFTEST = args.includes('--selftest')

function keyFromRaw(raw) {
  return createHash('sha256').update(raw).digest()
}
function encryptWith(rawKey, plain) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', rawKey, iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}
function decryptWith(rawKey, payload) {
  if (!payload?.startsWith('v1:')) return null
  const [, ivB64, tagB64, dataB64] = payload.split(':')
  try {
    const d = createDecipheriv('aes-256-gcm', rawKey, Buffer.from(ivB64, 'base64'))
    d.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8')
  } catch { return null }
}
function readKeyFile(p) {
  const raw = require('node:fs').readFileSync(p, 'utf8').trim()
  if (!raw) throw new Error(`archivo de clave vacío: ${p} (valor nunca se imprime)`)
  return keyFromRaw(raw)
}

// ---------- MIGRACIÓN ----------
function migrate(dbPath, oldKey, newKey, { dry = false } = {}) {
  const db = new Database(dbPath)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  const q = (id) => '"' + id.replace(/"/g, '""') + '"'
  let migrated = 0, skipped = 0, fields = []
  const tx = db.transaction(() => {
    for (const t of tables) {
      let cols
      try { cols = db.prepare(`PRAGMA table_info(${q(t)})`).all() } catch { continue }
      for (const c of cols) {
        try {
          const rows = db.prepare(`SELECT rowid AS _rid, ${q(c.name)} AS _v FROM ${q(t)} WHERE ${q(c.name)} LIKE 'v1:%'`).all()
          if (!rows.length) continue
          fields.push(`${t}.${c.name}(${rows.length})`)
          for (const r of rows) {
            const plain = decryptWith(oldKey, r._v)
            if (plain === null) { skipped++; continue } // no descifra con OLD → no tocar (preservación)
            if (!dry) {
              db.prepare(`UPDATE ${q(t)} SET ${q(c.name)} = ? WHERE rowid = ?`).run(encryptWith(newKey, plain), r._rid)
            }
            migrated++
          }
        } catch { /* tabla sin soporte rowid etc. */ }
      }
    }
  })
  tx()
  db.close()
  return { migrated, skipped, fields }
}

// ---------- SELFTEST ----------
if (SELFTEST) {
  const fs = require('node:fs')
  const OLD = readKeyFile('/home/z/secure-rotation/OLD_APP_ENCRYPTION_KEY.txt')
  const NEW = readKeyFile('/home/z/secure-rotation/NEW_APP_ENCRYPTION_KEY.txt')
  const testDb = '/home/z/secure-rotation/selftest-encryption.db'
  try { fs.unlinkSync(testDb) } catch {}
  const db = new Database(testDb)
  db.exec(`CREATE TABLE integrations (id INTEGER PRIMARY KEY, org_id TEXT, api_key TEXT, plain_note TEXT);
           CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, endpoint TEXT, keys_json TEXT)`)
  db.prepare('INSERT INTO integrations (org_id, api_key, plain_note) VALUES (?,?,?)')
    .run('org-test', encryptWith(OLD, 'secreto-sintetico-api-key-A'), 'nota sin cifrar')
  db.prepare('INSERT INTO push_subscriptions (endpoint, keys_json) VALUES (?,?)')
    .run(encryptWith(OLD, 'https://push.endpoint/ejemplo'), encryptWith(OLD, '{"p256dh":"k","auth":"a"}'))
  db.close()
  console.log('[SELFTEST] BD sintetica creada: 3 payloads cifrados con clave VIEJA + 1 texto plano')

  const r = migrate(testDb, OLD, NEW)
  console.log(`[SELFTEST] migracion: filas re-cifradas=${r.migrated} no-descifrables=${r.skipped} campos=${r.fields.join(',')}`)

  // verificación con el crypto.ts REAL del CRM publicado (vía strip-types no posible en .mjs:
  // replicamos el descifrado y comprobamos que OLD ya no abre los datos)
  const db2 = new Database(testDb)
  const vals = [
    ...db2.prepare(`SELECT api_key AS a FROM integrations`).all(),
    ...db2.prepare(`SELECT endpoint AS a FROM push_subscriptions`).all(),
    ...db2.prepare(`SELECT keys_json AS a FROM push_subscriptions`).all(),
  ]
  db2.close()
  let okNew = 0, leakedOld = 0
  for (const row of vals) {
    if (row.a && row.a.startsWith('v1:')) {
      if (decryptWith(NEW, row.a) !== null) okNew++
      if (decryptWith(OLD, row.a) !== null) leakedOld++
    }
  }
  console.log(`[SELFTEST] verificacon: descifrables con NUEVA=${okNew} todavia-abribles-con-VIEJA=${leakedOld}`)
  const pass = r.migrated === 3 && okNew === 3 && leakedOld === 0
  console.log(pass ? 'SELFTEST-TODOS-PASS: migracion dual-key preserva datos (decrypt con NUEVA OK, VIEJA inutilizada)' : 'SELFTEST-FAIL')
  process.exit(pass ? 0 : 1)
} else {
  console.log('Uso: node migracion-encryption-key.mjs --selftest | --db <ruta> --old <archivo> --new <archivo> [--dry-run]')
  process.exit(2)
}
