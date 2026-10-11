#!/usr/bin/env node
/**
 * Auditoría de código muerto — CRM ALBRA
 * Cruza: métodos de src/lib/api.ts vs uso real, componentes vs imports,
 * rutas API vs consumidores, dependencias vs imports.
 */
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

function walk(dir, exts, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (f === 'node_modules' || f === '.next' || f === '.wa-auth') continue
      walk(p, exts, out)
    } else if (exts.some((e) => f.endsWith(e))) out.push(p)
  }
  return out
}

const allFiles = walk(ROOT, ['.ts', '.tsx', '.mjs', '.js', '.json'])
const srcFiles = walk(SRC, ['.ts', '.tsx', '.mjs'])
const read = (p) => fs.readFileSync(p, 'utf8')

// ---------- 1. Métodos de api.ts sin uso ----------
const apiTs = read(path.join(SRC, 'lib/api.ts'))
const methods = [...apiTs.matchAll(/^\s{2}(?:async\s+)([a-zA-Z0-9_]+)\(/gm)].map((m) => m[1])
const consumerFiles = srcFiles.filter((p) => !p.includes('lib/api.ts'))
const consumers = consumerFiles.map((p) => [p, read(p)])
const unusedMethods = []
for (const m of methods) {
  const used = consumers.some(([p, c]) => new RegExp(`\\.${m}\\(`).test(c))
  if (!used) unusedMethods.push(m)
}
console.log('=== 1. Métodos de api.ts NUNCA llamados (' + unusedMethods.length + '/' + methods.length + ') ===')
console.log(unusedMethods.join('\n'))

// ---------- 2. Componentes nunca importados ----------
const compDir = path.join(SRC, 'components')
const compFiles = walk(compDir, ['.tsx'])
const pageAndApp = srcFiles.filter((p) => !p.startsWith(compDir)).map((p) => read(p))
const compImports = srcFiles.filter((p) => p.startsWith(compDir)).map((p) => read(p))
const unusedComponents = []
for (const cf of compFiles) {
  const base = path.basename(cf, '.tsx')
  if (base === 'page' || base === 'layout') continue
  const searchers = pageAndApp.concat(compImports.filter((_, i) => compFiles[i] !== cf))
  const used = searchers.some((c) => c.includes(base))
  if (!used) unusedComponents.push(path.relative(SRC, cf))
}
console.log('\n=== 2. Componentes nunca importados ===')
console.log(unusedComponents.join('\n') || '(ninguno)')

// ---------- 3. Rutas API sin ningún consumidor ----------
const apiDir = path.join(SRC, 'app', 'api')
const routeDirs = fs.readdirSync(apiDir).filter((d) => !d.startsWith('_'))
const knownExternal = ['whatsapp', 'telegram', 'instagram', 'mcp', 'health', 'cron', 'push', 'google'] // daemon/webhooks/docker los consumen
const deadRoutes = []
for (const r of routeDirs) {
  if (knownExternal.includes(r)) continue
  const outside = allFiles
    .filter((p) => !p.includes(path.join('app', 'api')))
    .filter((p) => p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.mjs'))
  const used = outside.some((p) => {
    const c = read(p)
    return c.includes(`'/api/${r}`) || c.includes(`"/api/${r}`) || c.includes('`/api/' + r) || c.includes(`request('/${r}`)
  })
  if (!used) deadRoutes.push(r)
}
console.log('\n=== 3. Rutas API sin consumidor en frontend/lib/daemon ===')
console.log(deadRoutes.join('\n') || '(ninguna)')

// ---------- 4. Dependencias sin uso ----------
const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
const scanTargets = srcFiles.concat(walk(path.join(ROOT, 'scripts'), ['.mjs', '.js', '.ts'])).map(read)
const configText = ['next.config.ts', 'postcss.config.mjs', 'tailwind.config.ts', 'prisma/schema.prisma', 'Dockerfile']
  .map((f) => { try { return read(path.join(ROOT, f)) } catch { return '' } })
  .join('\n')
const unusedDeps = []
for (const d of Object.keys(deps)) {
  if (['typescript', 'tailwindcss', 'eslint', 'prettier'].some((x) => d.startsWith(x))) continue
  const re = new RegExp(`from ['"]${d.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}|require\\(['"]${d.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'm')
  const used = scanTargets.some((c) => re.test(c)) || re.test(configText)
  if (!used) unusedDeps.push(d)
}
console.log('\n=== 4. Dependencias de package.json sin import en src/scripts/config ===')
console.log(unusedDeps.join('\n') || '(ninguna)')

// ---------- 5. NichoConfig: campos sin consumo real ----------
const nichoChecks = ['services', 'faqs', 'terminology', 'extra']
console.log('\n=== 5. NichoConfig.raw/extras consumidos en integrations.ts (contexto del agente) ===')
const integ = read(path.join(SRC, 'lib/integrations.ts'))
for (const f of nichoChecks) console.log(`${f}: ${integ.includes(f) ? 'USADO' : 'NO usado por el agente'}`)
