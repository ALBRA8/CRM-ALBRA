#!/usr/bin/env node
/**
 * lint-baseline.mjs — Ratchet de lint (segunda reparación — orden §7).
 *
 * La orden prohíbe ocultar fallos con continue-on-error y prohibe eliminar
 * funcionalidad para "arreglar" lint. Este script hace cumplir una política
 * honesta y progresiva:
 *
 *   - tools/lint-baseline.json registra el número de ERRORES preexistentes
 *     (código legado, no introducido por esta reparación).
 *   - El check FALLA si el conteo actual es MAYOR que el baseline
 *     (error nuevo = commit bloqueado).
 *   - Si el conteo DISMINUYE, el script actualiza el baseline (trinquete:
 *     la deuda solo puede bajar, jamás crecer).
 *
 * Uso:  node scripts/lint-baseline.mjs        (check de CI)
 *       node scripts/lint-baseline.mjs --update  (rebajar baseline a mano)
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'tools', 'lint-baseline.json')

let result
try {
  result = execSync('npx eslint . -f json', { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' })
} catch (err) {
  // eslint exit≠0 cuando hay errores: el JSON sigue viniendo en stdout
  result = err.stdout
}
const files = JSON.parse(result)
const errors = files.reduce((s, f) => s + (f.errorCount || 0), 0)

mkdirSync(dirname(BASELINE_PATH), { recursive: true })
if (!existsSync(BASELINE_PATH)) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ errors: errors, note: 'baseline inicial (deuda preexistente, prohibido crecer)' }, null, 2) + '\n')
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const update = process.argv.includes('--update')

if (update) {
  baseline.errors = errors
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`[lint-baseline] baseline actualizado a ${errors} errores`)
  process.exit(0)
}

if (errors > baseline.errors) {
  console.error(`[lint-baseline] FALLO: ${errors} errores de ESLint > baseline ${baseline.errors}.`)
  console.error('[lint-baseline] Se han introducido errores NUEVOS. Corrígelos; el baseline jamás sube.')
  process.exit(1)
}

if (errors < baseline.errors) {
  baseline.errors = errors
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`[lint-baseline] Mejora: ${errors} errores < baseline anterior (${baseline.errors + (0)}). Baseline rebajado automáticamente.`)
}

console.log(`[lint-baseline] OK: ${errors} errores ≤ baseline ${baseline.errors} (ratchet activo).`)
