#!/usr/bin/env node
/**
 * P0.4 — Escáner de secretos para el repositorio CRM-ALBRA.
 *
 * Uso:
 *   node scripts/scan-secrets.mjs            → escanea los archivos tracked
 *   node scripts/scan-secrets.mjs --history  → + historial git completo (todos los commits)
 *   node scripts/scan-secrets.mjs --files-only --history --json=report.json
 *
 * Clasificación:
 *   CRITICAL → patrón de credencial REAL (tokens ghp_/AKIA/claves privadas/
 *              webhooks albra_* con entropía, etc.). Exit 1.
 *   INFO     → marcadores de ejemplo/dummy esperados (REPLACE_WITH_, cambia-esto_,
 *              ci-dummy-). Se listan pero NO fallan (son la plantilla y el CI).
 *
 * NUNCA imprime el secreto completo: máscara de 8 caracteres + longitud.
 * La salida es un inventario para rotación, no un oracle de valores.
 */
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const wantHistory = args.includes('--history')
const jsonOut = (args.find((a) => a.startsWith('--json=')) || '').split('=')[1] || null

// ---------- Patrones CRITICAL (credenciales reales) ----------
const CRITICAL = [
  { id: 'github_pat_classic', re: /ghp_[A-Za-z0-9]{20,}/g },
  { id: 'github_pat_fine', re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { id: 'github_oauth', re: /gh[osr]_[A-Za-z0-9]{20,}/g },
  { id: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/g },
  { id: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: 'slack_token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'google_api_key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { id: 'openai_like', re: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  // formato real de webhook secret del CRM (WHATSPOWER_WEBHOOK_SECRET / telegram)
  { id: 'albra_webhook_secret', re: /albra_[0-9a-f]{16,}/g },
]
// hex de 64 (sha256/token crudo) SOLO en archivos de configuración/código,
// nunca en lockfiles ni docs (evitar ruido de integridades y ejemplos didácticos)
const CRITICAL_SCOPED = [
  {
    id: 'hex64_secret',
    re: /\b[A-Fa-f0-9]{64}\b/g,
    pathAllow: /\.(env|ya?ml|json|sh|mjs|cjs|ts|py|toml|ini|conf)$/i,
    pathDeny: /(package-lock\.json|bun\.lock|tests?\/|\.test\.|seed|docs\/)/i,
  },
]

// ---------- Patrones INFO (esperados en plantilla/CI) ----------
const INFO = [
  { id: 'example_marker', re: /REPLACE_WITH_[A-Z_]+/g },
  { id: 'example_phrase', re: /cambia-esto-[a-z0-9-]+/g },
  { id: 'ci_dummy', re: /ci-dummy-[a-z0-9-]+/g },
  { id: 'dev_token', re: /albra-dev-token/g },
]

function mask(match) {
  return `${match.slice(0, 8)}…(len=${match.length})`
}

function scanText(text, source) {
  const findings = []
  const push = (severity, id, line, value) => {
    findings.push({ severity, id, source, line, value: mask(value) })
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const p of CRITICAL) {
      for (const m of line.matchAll(p.re)) push('CRITICAL', p.id, i + 1, m[0])
    }
    const scopedOk = CRITICAL_SCOPED.some((p) => p.pathAllow.test(source) && !p.pathDeny.test(source))
    if (scopedOk) {
      for (const m of line.matchAll(CRITICAL_SCOPED[0].re)) push('CRITICAL', 'hex64_secret', i + 1, m[0])
    }
    for (const p of INFO) {
      for (const m of line.matchAll(p.re)) push('INFO', p.id, i + 1, m[0])
    }
  }
  return findings
}

function trackedFiles() {
  const out = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split('\n').filter(Boolean)
}

function gitHistoryText() {
  // -U0: sin contexto; todo el historial de todas las ramas
  const res = spawnSync('git', ['log', '--all', '-p', '-U0', '--no-color'], { maxBuffer: 1024 * 1024 * 1024, encoding: 'utf8' })
  if (res.error || res.status !== 0) {
    console.error('[scan] git log falló:', res.stderr?.slice(0, 200))
    return ''
  }
  return res.stdout
}

const findings = []

// ---------- Archivos tracked ----------
for (const file of trackedFiles()) {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // binario o ilegible
  }
  if (text.includes('\u0000')) continue // binario
  findings.push(...scanText(text, file))
}

// ---------- Historial (opcional) ----------
if (wantHistory) {
  const text = gitHistoryText()
  // El historial se escanea como un único blob, pero atribuyendo el commit:
  let currentCommit = 'historial'
  const chunkByCommit = []
  let buf = []
  for (const line of text.split('\n')) {
    if (line.startsWith('commit ')) {
      if (buf.length) chunkByCommit.push({ commit: currentCommit, lines: buf })
      currentCommit = line.slice(7, 7 + 12)
      buf = []
    } else {
      buf.push(line)
    }
  }
  if (buf.length) chunkByCommit.push({ commit: currentCommit, lines: buf })
  for (const chunk of chunkByCommit) {
    const f = scanText(chunk.lines.join('\n'), `git:${chunk.commit}`)
    findings.push(...f)
  }
}

// ---------- Reporte ----------
const critical = findings.filter((f) => f.severity === 'CRITICAL')
const info = findings.filter((f) => f.severity === 'INFO')

console.log(`\n[scan-secrets] Archivos escaneados: tracked${wantHistory ? ' + HISTORIAL COMPLETO' : ''}`)
console.log(`[scan-secrets] CRITICAL: ${critical.length} · INFO: ${info.length}\n`)

for (const f of critical) {
  console.log(`  [CRITICAL] ${f.id.padEnd(22)} ${f.source}:${f.line} → ${f.value}`)
}
for (const f of info.slice(0, 40)) {
  console.log(`  [info]     ${f.id.padEnd(22)} ${f.source}:${f.line} → ${f.value}`)
}
if (info.length > 40) console.log(`  [info]     … y ${info.length - 40} más (marcadores de plantilla/CI esperados)`)

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), critical, info }, null, 2))
  console.log(`\n[scan-secrets] Reporte JSON: ${jsonOut}`)
}

console.log(
  `\n[scan-secrets] RESULTADO: ${critical.length === 0 ? '✅ sin credenciales reales detectadas' : '❌ HAY CREDENCIALES REALES — rotar y revocar YA (borrar del archivo no invalida)'}`
)
process.exit(critical.length === 0 ? 0 : 1)
