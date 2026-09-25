#!/usr/bin/env node
/**
 * Copia multiplataforma de assets al build standalone de Next.js.
 * Reemplaza `cp -r` (incompatible con Windows/PowerShell — auditoría Antigravity,
 * mejorable #2). Funciona en Linux, macOS y Windows con Node >= 16.7 (fs.cpSync).
 */
import { cpSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const staticSrc = join(root, '.next', 'static')
const staticDst = join(root, '.next', 'standalone', '.next', 'static')
const publicSrc = join(root, 'public')
const publicDst = join(root, '.next', 'standalone', 'public')

if (!existsSync(staticSrc)) {
  console.error('[build] Falta .next/static — ejecuta `next build` primero.')
  process.exit(1)
}
cpSync(staticSrc, staticDst, { recursive: true })
console.log('[build] .next/static copiado a standalone')

if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDst, { recursive: true })
  console.log('[build] public copiado a standalone')
}
