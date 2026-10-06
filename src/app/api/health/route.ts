import { json } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { APP_VERSION } from '@/lib/version'

/**
 * GET /api/health — liveness + readiness ligera (público, para load balancers
 * y el healthcheck de Docker). Debe responder RÁPIDO: nunca toca proveedores
 * externos con timeouts largos; el diagnóstico completo vive en /api/doctor.
 */
export async function GET() {
  const checks: Record<string, boolean> = { db: false }
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout')), 2000)),
    ])
    checks.db = true
  } catch {}
  return json({ ok: checks.db, ts: new Date().toISOString(), version: APP_VERSION, checks })
}
