#!/usr/bin/env node
/**
 * ensure-env — garantiza que .env tenga TODAS las claves obligatorias.
 * Idempotente: solo AÑADE las que falten con valores aleatorios seguros.
 * Invocado automáticamente vía "predev".
 * OJO: si APP_ENCRYPTION_KEY se regenera, re-guardar credenciales de
 * integraciones en Configuración (las cifradas con la clave previa no son legibles).
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ENV_PATH = resolve(process.cwd(), '.env')
const REQUIRED = [
  { key: 'DATABASE_URL', value: 'file:/home/z/my-project/db/custom.db' },
  { key: 'APP_SECRET', gen: 32 },
  { key: 'APP_ENCRYPTION_KEY', gen: 32 },
  { key: 'INTERNAL_API_SECRET', gen: 36 },
  { key: 'WHATSAPP_DAEMON_URL', value: 'http://localhost:3002' },
]
let lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split('\n') : []
const present = new Set(lines.map((l) => l.split('=')[0].trim()).filter(Boolean))
const added = []
for (const r of REQUIRED) {
  if (present.has(r.key)) continue
  const v = r.gen ? randomBytes(r.gen).toString('base64') : r.value
  lines.push(`${r.key}="${v}"`)
  added.push(r.key)
}
writeFileSync(ENV_PATH, lines.filter((l, i, a) => !(l === '' && i === a.length - 1)).join('\n') + '\n', { mode: 0o600 })
console.log(added.length ? `[ensure-env] Añadidas: ${added.join(', ')}` : '[ensure-env] .env completo')
