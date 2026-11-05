#!/usr/bin/env node
/**
 * Lanzador DETACHED del daemon de WhatsApp (mismo patrón probado en
 * WHATSPOWER y WHATSPOWER-ULTRA): doble fork + unref para que el daemon
 * sobreviva al cierre de sesión del sandbox/terminal.
 *
 * Uso: node scripts/start-daemon-detached.mjs
 * Log: daemon.log en la raíz del proyecto.
 */
import { spawn } from 'child_process'
import { openSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = openSync(join(root, 'daemon.log'), 'a')

appendFileSync(join(root, 'daemon.log'), `\n[launcher] ${new Date().toISOString()} lanzando daemon detached\n`)

const child = spawn('node', ['src/whatsapp-daemon/daemon.mjs'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', out, out],
  env: { ...process.env },
})
child.unref()

console.log(`[launcher] daemon lanzado detached (pid ${child.pid}), log: daemon.log`)
