#!/usr/bin/env node
/**
 * Arranque multiplataforma del servidor standalone (reemplaza
 * `NODE_ENV=production bun ...`, incompatible con Windows — auditoría).
 */
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const server = join(root, '.next', 'standalone', 'server.js')

const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
})
child.on('exit', (code) => process.exit(code ?? 0))
