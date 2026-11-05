import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db'
import { req, tokenFor } from '../helpers'
import { FIX } from '../setup/seed-data'
import { POST as backupPOST, MAX_BACKUP_BODY_BYTES } from '@/app/api/backup/route'

/**
 * REPARACIÓN INTEGRAL B5 — backup/restauración endurecida:
 *  - tope de 25 MB → 413;
 *  - restauración atómica en transacción (reporte `transactional: true`);
 *  - JAMÁS introduce registros en otra organización (todo se fuerza a la org del admin).
 */

describe('B5: backup/restauración endurecida', () => {
  it('BKP-01: restauración exitosa con reporte transaccional y datos SOLO en la org autenticada', async () => {
    const before = await db.client.count({ where: { organizationId: FIX.orgA.id } })
    const body = {
      clients: [
        { id: 'old_cli_1', name: 'Restaurado Uno', phone: '573001112233', status: 'active' },
        { name: 'Restaurado Dos', phone: '573004445566' },
      ],
      transactions: [
        { type: 'income', amount: 25000, currency: 'COP', description: 'Cobro restaurado', date: '2026-01-15' },
      ],
    }
    const res = await backupPOST(req('/api/backup', { token: tokenFor(FIX.userA), method: 'POST', body }))
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.success).toBe(true)
    expect(data.transactional).toBe(true, 'la restauración es atómica (transacción)')
    expect(data.restored.clients).toBeGreaterThanOrEqual(2)
    expect(data.restored.transactions).toBeGreaterThanOrEqual(1)

    // Todo quedó en la org del admin autenticado.
    const after = await db.client.count({ where: { organizationId: FIX.orgA.id } })
    expect(after).toBeGreaterThan(before)

    // JAMÁS se introdujo nada en otra organización.
    const otherOrg = FIX.orgB.id
    const leaked = await db.client.count({
      where: { organizationId: otherOrg, phone: { in: ['573001112233', '573004445566'] } },
    })
    expect(leaked).toBe(0)
  })

  it('BKP-02: body mayor que el tope (25 MB) → 413 sin procesar nada', async () => {
    const big = 'x'.repeat(MAX_BACKUP_BODY_BYTES + 1024)
    const headers = new Headers({
      'authorization': `Bearer ${tokenFor(FIX.userA)}`,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(big)),
    })
    const { NextRequest } = await import('next/server')
    const bigReq = new NextRequest('http://localhost:3000/api/backup', { method: 'POST', headers, body: big })
    const res = await backupPOST(bigReq)
    expect(res.status).toBe(413)
  })

  it('BKP-03: restauración anónima → 401 (ninguna ruta de backup sin sesión admin)', async () => {
    const res = await backupPOST(req('/api/backup', { method: 'POST', body: { clients: [] } }))
    expect([401, 403]).toContain(res.status)
  })
})
