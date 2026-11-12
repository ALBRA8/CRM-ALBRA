import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

describe('scripts/db-guard.mjs — Protección contra operaciones destructivas', () => {
  const scriptPath = resolve(__dirname, '../../scripts/db-guard.mjs')

  it('bloquea db:push y db:reset cuando NODE_ENV=production sin override (exit code 1)', () => {
    const res = spawnSync('node', [scriptPath, 'reset'], {
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('BLOQUEO DE SEGURIDAD DE BASE DE DATOS')
    expect(res.stderr).toContain("operación destructiva 'reset'")
  })

  it('bloquea cuando la URL de base de datos apunta a un cluster de producción', () => {
    const res = spawnSync('node', [scriptPath, 'push'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://user:pass@prod-cluster.neon.tech/main' },
      encoding: 'utf8',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('BLOQUEO DE SEGURIDAD DE BASE DE DATOS')
  })
})
