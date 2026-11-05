#!/usr/bin/env node
/**
 * lint-baseline.mjs — Reducción progresiva del baseline de ESLint (B7).
 *
 * Estrategia (orden de trabajo 2026-11-06):
 *  - El lint NO bloquea por el baseline histórico (331 errores heredados),
 *    pero SÍ bloquea si el número de ERRORES crece respecto al baseline
 *    registrado en scripts/security/eslint-baseline.json.
 *  - Reducción progresiva: cuando se arreglan errores, se actualiza el baseline
 *    a la baja. Prohibido subirlo.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASELINE_PATH = 'scripts/security/eslint-baseline.json'

let out = ''
try {
  out = execSync('npx eslint . --format json', { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
} catch (e) {
  out = String(e.stdout || '')
}

let results = []
try { results = JSON.parse(out) } catch { results = [] }
const errorCount = results.reduce((acc, r) => acc + (r.errorCount || 0), 0)
const warningCount = results.reduce((acc, r) => acc + (r.warningCount || 0), 0)

let baseline = { errors: 0, warnings: 0, updatedAt: '', note: '' }
if (existsSync(BASELINE_PATH)) {
  try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) } catch {}
}

console.log(`ESLint: ${errorCount} errores, ${warningCount} warnings (baseline: ${baseline.errors} errores)`)

if (!baseline.updatedAt) {
  // Primera ejecución: fija el baseline (no bloquea).
  writeFileSync(BASELINE_PATH, JSON.stringify({ errors: errorCount, warnings: warningCount, updatedAt: new Date().toISOString(), note: 'baseline histórico heredado — solo puede BAJAR' }, null, 2) + '\n')
  console.log('Baseline inicial registrado.')
  process.exit(0)
}

if (errorCount > baseline.errors) {
  console.error(`✗ ERRORES NUEVOS: ${errorCount} > baseline ${baseline.errors}. Corrige los errores introducidos (prohibido subir el baseline).`)
  process.exit(1)
}

if (errorCount < baseline.errors) {
  baseline.errors = errorCount
  baseline.warnings = warningCount
  baseline.updatedAt = new Date().toISOString()
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`✓ Baseline reducido a ${errorCount} errores.`)
}
process.exit(0)
