import { describe, expect, it } from 'vitest'
import { GET as doctorGet } from '@/app/api/doctor/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'

/**
 * DOCTOR (§21): AUDIT → DIAGNOSE → VERIFY → REPORT.
 * - Owner/admin recibe veredicto con checks completos y SIN secretos.
 * - Member → 403.
 * - ?fix=1 aplica el único fix determinista permitido (runs huérfanos).
 */

describe('GET /api/doctor', () => {
  it('member → 403 (solo owner/admin diagnostican)', async () => {
    const res = await doctorGet(req('/api/doctor', { token: tokenB() }))
    expect(res.status).toBe(403)
  })

  it('owner recibe checks completos, veredicto y NINGÚN secreto en la respuesta', async () => {
    const res = await doctorGet(req('/api/doctor', { token: tokenA() }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const ids = (body.checks as Array<{ id: string }>).map((c) => c.id)
    for (const expected of ['db', 'schema', 'security', 'whatsapp', 'ai', 'memory', 'automations', 'integrations']) {
      expect(ids).toContain(expected)
    }
    expect(['healthy', 'degraded', 'critical']).toContain(body.verdict)
    const dbCheck = (body.checks as Array<{ id: string; status: string }>).find((c) => c.id === 'db')
    expect(dbCheck?.status).toBe('ok')
    // Nunca un secreto real en el reporte
    const text = JSON.stringify(body)
    expect(text).not.toContain(process.env.APP_SECRET as string)
    expect(text).not.toContain(process.env.INTERNAL_API_SECRET as string)
  })

  it('?fix=1 marca el run huérfano como failed (fix determinista, sin tocar datos comerciales)', async () => {
    const auto = await db.automation.create({
      data: { organizationId: 'org-a', name: 'Doc-fixture', triggerType: 'client_created', conditions: '[]', actions: '[]', isActive: true },
    })
    const run = await db.automationRun.create({
      data: { organizationId: 'org-a', automationId: auto.id, status: 'running', startedAt: new Date(Date.now() - 30 * 60_000) },
    })
    try {
      const res = await doctorGet(req('/api/doctor?fix=1', { token: tokenA() }))
      const body = await jsonBody(res)
      expect((body.fixed as Record<string, number>).orphanRunsMarkedFailed).toBeGreaterThanOrEqual(1)
      const after = await db.automationRun.findUnique({ where: { id: run.id } })
      expect(after!.status).toBe('failed')
      const client = await db.client.findUnique({ where: { id: FIX.clientA1.id } })
      expect(client?.name).toBe('Cliente Alpha') // datos comerciales intactos
    } finally {
      await db.automation.delete({ where: { id: auto.id } })
    }
  })
})
