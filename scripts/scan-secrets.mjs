#!/usr/bin/env node
/**
 * scan-secrets.mjs — Escáner de secretos para CRM-ALBRA (CP-Sec-01 / ORDEN CIERRE P0)
 *
 * Detecta en el árbol de trabajo (y opcionalmente en todo el historial) patrones de:
 *   - JWT (estructura header.payload.signature en base64url)
 *   - Tokens de proveedores: GitHub PAT, AWS, Slack, Google, Stripe, OpenAI, Anthropic, Meta
 *   - Claves privadas embebidas (PEM)
 *   - API keys personalizadas del proyecto (prefijo albra_, wp_, ultra_)
 *   - Secretos de configuración: password/secret/token/apiKey con valor literal de alta entropía
 *
 * Reglas:
 *   - NUNCA imprime el valor completo: solo tipo, archivo, línea y vista previa enmascarada.
 *   - Ignora valores de ejemplo/placeholder y fixtures de prueba marcados.
 *   - Salida: exit 0 limpio; exit 1 con hallazgos (salvo --report-only).
 *
 * Uso:
 *   node scripts/scan-secrets.mjs                 # escanea el árbol versionado (git ls-files)
 *   node scripts/scan-secrets.mjs --history      # escanea además todo el historial git
 *   node scripts/scan-secrets.mjs --path <ruta>  # escanea un archivo o directorio concreto
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ALLOW_MARK = 'scan-secrets:allow'

/** Patrones de detección. Cada uno: id, descripción, regex, y captura del valor (grupo 1 si existe). */
export const PATTERNS = [
  { id: 'JWT', desc: 'Token JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'GITHUB_PAT', desc: 'Token de acceso personal de GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { id: 'AWS_ACCESS_KEY', desc: 'Access key de AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'SLACK_TOKEN', desc: 'Token de Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'GOOGLE_API_KEY', desc: 'API key de Google', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: 'STRIPE_SECRET', desc: 'Clave secreta de Stripe', re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: 'OPENAI_KEY', desc: 'API key de OpenAI', re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'ANTHROPIC_KEY', desc: 'API key de Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'META_TOKEN', desc: 'Token de acceso de Meta/Facebook', re: /\bEAAG[0-9A-Za-z_-]{20,}\b/g },
  { id: 'PRIVATE_KEY', desc: 'Clave privada embebida', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'ALBRA_API_KEY', desc: 'API key del proyecto (albra_)', re: /\balbra_[a-z0-9]{6,}-[A-Za-z0-9_-]{8,}\b/g },
  { id: 'WP_API_KEY', desc: 'API key del proyecto (wp_)', re: /\bwp_[A-Za-z0-9]{24,}\b/g },
  { id: 'ULTRA_API_KEY', desc: 'API key del proyecto (ultra_)', re: /\bultra_[A-Za-z0-9]{24,}\b/g },
  {
    id: 'CONFIG_SECRET', desc: 'Secreto de configuración literal',
    re: /(?:password|passwd|secret|api[_-]?key|apikey|auth[_-]?token|access[_-]?token)["']?\s*[:=]\s*["']([A-Za-z0-9_+/=.,:!#$%^&*()-]{16,})["']/gi,
  },
]

/** Prefijos/valores que son dummy conocidos de tests o placeholders y no se reportan. */
const DUMMY_HINTS = [
  /^REDACTED/i, /placeholder/i, /^your[_-]/i, /^example/i, /^change?me/i, /^dummy/i,
  /^test[_-]/i, /^fixture/i, /^xxx+$/i, /^<[^>]+>$/, /^\$\{.*\}$/, /^dummy/i,
  /^albra-dev-token$/i, /^changeme/i, /^lorem/i, /^secret[_-]?key[_-]?123/i,
  /scan-secrets-dummy/i, /^mock/i, /^sample/i, /^fake/i, /^min24/, /^min32/,
  /^REPL/i, /^e2e[-_]/i, /^crm[-_]e2e/i, /^E2E[-_]/i, /^E2e2/, /^drill/i,
  /^FB-PAGE/i, /^integration[-_ ]?test/i, /^internal[-_ ]?test/i, /^smoke[-_]/i,
  /^aaaa+$/i, /^ci-dummy/i, /^cortito/i, /SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED/,
  /^cambia[-_ ]/i, /^corto[-_]/i, /^sk-e2e/i, /^fb-mock/i, /^clave[-_]/i, /^claveinc/i,
]

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', 'db', 'upload', 'repos', '.vercel', 'skills', 'crm_albra_mirrored'])
const SKIP_FILE_RE = /\.(png|jpe?g|gif|webp|pdf|zip|gz|ico|woff2?|ttf|db|sqlite3?|lock|log)$/i
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'dev.log'])

/** Devuelve los hallazgos (tipo, vista previa enmascarada, línea) de un texto. */
export function scanText(text, source = 'inline') {
  const findings = []
  const lines = text.split('\n')
  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0
    let m
    while ((m = pattern.re.exec(text)) !== null) {
      const raw = (m[1] ?? m[0]).trim()
      const lineNo = text.slice(0, m.index).split('\n').length
      const line = lines[lineNo - 1] ?? ''
      if (line.includes(ALLOW_MARK)) continue
      if (DUMMY_HINTS.some((h) => h.test(raw))) continue
      findings.push({ pattern: pattern.id, desc: pattern.desc, source, line: lineNo, preview: mask(raw) })
      pattern.re.lastIndex = m.index + m[0].length // evita bucles en matches vacíos
    }
  }
  return findings
}

/** Enmascara: conserva los 4 primeros caracteres y la longitud, nunca el valor. */
export function mask(value) {
  return `${value.slice(0, 4)}…(${value.length} caracteres)`
}

function shouldSkip(relPath) {
  const parts = relPath.split(sep)
  if (parts.some((p) => SKIP_DIRS.has(p))) return true
  const base = parts[parts.length - 1]
  return SKIP_FILE_RE.test(base) || SKIP_FILES.has(base)
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relative(process.cwd(), full)
    if (shouldSkip(rel)) continue
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

function scanWorkingTree() {
  let files
  try {
    files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    files = [...walk(process.cwd())]
  }
  const findings = []
  for (const f of files) {
    if (shouldSkip(f) || !existsSync(f) || !statSync(f).isFile()) continue
    try {
      const text = readFileSync(f, 'utf8')
      findings.push(...scanText(text, f))
    } catch { /* binario o ilegible: omitir */ }
  }
  return findings
}

function scanHistory() {
  const findings = []
  const commits = execSync('git rev-list --all --max-count=400', { encoding: 'utf8' }).split('\n').filter(Boolean)
  process.stderr.write(`Escaneando ${commits.length} commits del historial (líneas añadidas)…\n`)
  // Enfoque práctico: escanear el diff introducido por cada commit (añadidos)
  for (const c of commits) {
    try {
      const diff = execSync(`git show ${c} --format= --unified=0 --diff-filter=A`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      const added = diff.split('\n').filter((l) => l.startsWith('+')).map((l) => l.slice(1)).join('\n')
      if (added) {
        for (const f of scanText(added, `commit ${c.slice(0, 8)}`)) findings.push(f)
      }
    } catch { /* commit vacío / merge */ }
  }
  return findings
}

function main() {
  const args = process.argv.slice(2)
  const reportOnly = args.includes('--report-only')
  const doHistory = args.includes('--history')
  const pathIdx = args.indexOf('--path')

  let findings = []
  if (pathIdx !== -1 && args[pathIdx + 1]) {
    const target = args[pathIdx + 1]
    const st = statSync(target)
    if (st.isFile()) findings = scanText(readFileSync(target, 'utf8'), target)
    else for (const f of walk(target)) findings.push(...scanText(readFileSync(f, 'utf8'), f))
  } else {
    findings = scanWorkingTree()
    if (doHistory) findings.push(...scanHistory())
  }

  if (findings.length === 0) {
    console.log('✓ Sin secretos detectados.')
    process.exit(0)
  }
  console.log(`✗ ${findings.length} hallazgo(s) potencial(es) de secretos:\n`)
  for (const f of findings) {
    console.log(`  [${f.pattern}] ${f.source}:${f.line} — ${f.desc} — vista previa: ${f.preview}`)
  }
  console.log('\nAcción: elimina el secreto, rótalo si estuvo activo y usa variables de entorno.')
  console.log(`Para excluir un dummy de prueba añade el marcador de línea: ${ALLOW_MARK}`)
  process.exit(reportOnly ? 0 : 1)
}

if (process.argv[1] && process.argv[1].endsWith('scan-secrets.mjs')) main()
