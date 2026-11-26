#!/usr/bin/env node
/**
 * verify-doc-figures.mjs — (E4) verificador de cifras documentales contra el código.
 *
 * La "falsa confianza" documental (readiness con cifras que cambiaron sin
 * actualizarse) se cierra con un bloque canónico en PRODUCTION_READINESS.md
 * que este script RECUENTA del código real en cada corrida:
 *
 *   <!-- FIGURAS-CANONICAS-INICIO ... -->
 *   rutas_api: 125
 *   ...
 *   <!-- FIGURAS-CANONICAS-FIN -->
 *
 * Uso:
 *   node scripts/verify-doc-figures.mjs            # valida el bloque (exit 0/1)
 *   node scripts/verify-doc-figures.mjs --print    # imprime las cifras reales (para actualizar el bloque)
 *   node scripts/verify-doc-figures.mjs --json     # JSON de las cifras reales
 *
 * Reglas de conteo (deterministas, sin ejecutar la suite, 100% Node — sin
 * find/wc/ls/grep del shell, que en Windows no existen o colisionan con los
 * executables nativos: hallazgo Antigravity 2026-11-26):
 *   - rutas_api:        archivos route.ts bajo src/app/api
 *   - archivos_prueba:  archivos test.ts bajo tests/ (cualquier profundidad)
 *   - modelos_prisma:   bloques `model X` en prisma/schema.prisma
 *   - migraciones:      directorios en prisma/migrations (sin migration_lock)
 *   - componentes_ui:   archivos .tsx en src/components
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** Caminante recursivo multiplataforma: devuelve los archivos que cumplen el
 *  predicado bajo dir (sin depender del shell). En un árbol sin la pieza
 *  (p. ej. entorno de prueba), devuelve []. */
function walkFiles(dir, predicate, depth = 0) {
  if (depth > 32) return [] // cinturón de seguridad ante ciclos de symlink
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...walkFiles(join(dir, entry.name), predicate, depth + 1))
    } else if (entry.isFile() && predicate(entry.name)) {
      found.push(join(dir, entry.name))
    }
  }
  return found
}

function readFileSoft(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function realFigures() {
  const rutasApi = walkFiles(join(ROOT, 'src/app/api'), (name) => name === 'route.ts')
  const archivosPrueba = walkFiles(join(ROOT, 'tests'), (name) => name.endsWith('.test.ts'))
  const schema = readFileSoft(join(ROOT, 'prisma/schema.prisma')) ?? ''
  const modelos = (schema.match(/^model\s+\w+/gm) ?? []).length
  const migraciones = (() => {
    try {
      return readdirSync(join(ROOT, 'prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).length
    } catch {
      return 0
    }
  })()
  const componentes = walkFiles(join(ROOT, 'src/components'), (name) => name.endsWith('.tsx'))
  return {
    rutas_api: rutasApi.length,
    archivos_prueba: archivosPrueba.length,
    modelos_prisma: modelos,
    migraciones,
    componentes_ui: componentes.length,
  }
}

const DOC = join(ROOT, 'PRODUCTION_READINESS.md')
const START = '<!-- FIGURAS-CANONICAS-INICIO'
const END_TOKEN = 'FIGURAS-CANONICAS-FIN'

function parseCanonicalBlock(text) {
  const i = text.indexOf(START)
  if (i < 0) throw new Error('Bloque FIGURAS-CANONICAS no encontrado en PRODUCTION_READINESS.md')
  const j = text.indexOf(END_TOKEN, i)
  if (j < 0) throw new Error('Bloque FIGURAS-CANONICAS sin cierre')
  const body = text.slice(i, j)
  const figs = {}
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\w+)\s*:\s*(\d+)\s*$/)
    if (m) figs[m[1]] = Number(m[2])
  }
  return figs
}

// Orden de fallos: primero el documento (falla ruidoso si falta el bloque),
// después las cifras reales (cuento con fallo suave para entornos parciales).
if (!existsSync(DOC)) {
  console.error('No se encontró PRODUCTION_READINESS.md')
  process.exit(1)
}

let declared
try {
  declared = parseCanonicalBlock(readFileSync(DOC, 'utf8'))
} catch (e) {
  console.error(`ERROR: ${e.message}`)
  process.exit(1)
}

const figs = realFigures()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(figs, null, 2))
  process.exit(0)
}

if (process.argv.includes('--print')) {
  console.log('<!-- FIGURAS-CANONICAS-INICIO (verificado por scripts/verify-doc-figures.mjs — no editar a mano) -->')
  for (const [k, v] of Object.entries(figs)) console.log(`${k}: ${v}`)
  console.log('<!-- FIGURAS-CANONICAS-FIN -->')
  process.exit(0)
}

const mismatches = []
for (const [k, v] of Object.entries(figs)) {
  if (!(k in declared)) mismatches.push(`Falta en el bloque: ${k}`)
  else if (declared[k] !== v) mismatches.push(`${k}: documento declara ${declared[k]}, el código tiene ${v}`)
}
for (const k of Object.keys(declared)) {
  if (!(k in figs)) mismatches.push(`El bloque declara "${k}" que el verificador no reconoce`)
}

if (mismatches.length > 0) {
  console.error('CIFRAS DESALINEADAS — actualiza el bloque canónico (node scripts/verify-doc-figures.mjs --print):')
  for (const m of mismatches) console.error(`  - ${m}`)
  process.exit(1)
}

console.log(`OK — cifras del documento conciliadas con el código: ${Object.entries(figs).map(([k, v]) => `${k}=${v}`).join(', ')}`)
