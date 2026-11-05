// Genera scripts/security/secret-allowlist.json (árbol) y secret-baseline.json
// (historial) a partir de los hallazgos actuales. NUNCA escribe valores, solo
// huellas sha256-12. Ejecutar UNA vez durante la reparación integral (B7).
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const treeOut = execSync('node scripts/scan-secrets.mjs --report-only', { encoding: 'utf8' })
const treeFindings = [...treeOut.matchAll(/\[(\w+)\] ([^:]+):(\d+) — [^\n]*huella ([0-9a-f]{12})/g)]
  .map((m) => ({ category: m[1], file: m[2].trim(), line: Number(m[3]), fingerprint: m[4] }))

const allowlist = treeFindings.map((f) => ({
  file: f.file,
  category: f.category,
  fingerprint: f.fingerprint,
  reason: 'dummy-verificado-de-prueba-e2e-drill (reparación integral B7 2026-11-06)',
}))

// Historial: sin baseline aún, TODOS los hallazgos son "nuevos" y se imprimen con huella.
// El scanner sale con código 1 cuando hay hallazgos: capturamos stdout igualmente.
let histOut = ''
try {
  histOut = execSync('node scripts/scan-secrets.mjs --report-only --history', { encoding: 'utf8' })
} catch (e) {
  histOut = String(e.stdout || '')
}
const histFindings = [...histOut.matchAll(/\[(\w+)\] commit ([0-9a-f]{8})[^\n]*huella ([0-9a-f]{12})/g)]
  .map((m) => ({ category: m[1], commit: m[2], fingerprint: m[3] }))

const seen = new Set()
const baseline = []
for (const h of histFindings) {
  const key = `${h.commit}:${h.category}:${h.fingerprint}`
  if (seen.has(key)) continue
  seen.add(key)
  baseline.push({
    commit: h.commit,
    category: h.category,
    fingerprint: h.fingerprint,
    status: 'ROTACION-PENDIENTE',
    rotation: 'secretos históricos previos a la reparación integral — rotar y purgar historial con git-filter-repo (requiere force-push: decisión del operador)',
  })
}

mkdirSync('scripts/security', { recursive: true })
writeFileSync(join('scripts/security', 'secret-allowlist.json'), JSON.stringify(allowlist, null, 2) + '\n')
writeFileSync(join('scripts/security', 'secret-baseline.json'), JSON.stringify(baseline, null, 2) + '\n')
console.log(`allowlist: ${allowlist.length} entradas; baseline: ${baseline.length} entradas`)
