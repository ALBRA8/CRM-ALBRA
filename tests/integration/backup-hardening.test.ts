import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as backupPost } from '@/app/api/backup/route'
import { db } from '@/lib/db'
import { FIX, tokenA, req, jsonBody } from '../helpers'

/**
 * TERCERA REPARACIÓN — 6.A BACKUP/RESTORE ENDURECIDO:
 *  - el tope de 25 MB es EFECTIVO sobre el stream leído (chunked o sin
 *    Content-Length NO lo evade);
 *  - estructura y versión del backup se validan ANTES de restaurar;
 *  - un JSON corrupto produce 400 y NINGUNA restauración parcial
 *    (la transacción es todo-o-nada);
 *  - la restauración siempre se atribuye a la organización del operador.
 */

const authHeaders = (): Headers => {
  const h = new Headers()
  h.set('authorization', `Bearer ${tokenA()}`)
  return h
}

/** POST con body en STREAM por chunks y SIN Content-Length (simula chunked). */
function postWithChunkedStream(chunks: Uint8Array[]): NextRequest {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  // (NextRequest: el duplex y el stream requieren un cast del RequestInit de undici)
  const init = { method: 'POST', headers: authHeaders(), body: stream, duplex: 'half' } as unknown as ConstructorParameters<typeof NextRequest>[1]
  return new NextRequest('http://localhost:3000/api/backup', init)
}

describe('BACKUP/RESTORE endurecido (tercera reparación 6.A)', () => {
  it('rechaza 413 un body chunked de >25MB SIN Content-Length (el tope es efectivo sobre el stream)', async () => {
    const MB = 1024 * 1024
    const chunk = new Uint8Array(MB).fill(0x61) // 'a' x 1MB (JSON inválido pero el corte ocurre ANTES de parsear)
    const chunks: Uint8Array[] = []
    for (let i = 0; i < 26; i++) chunks.push(chunk) // 26 MB sin cabecera de tamaño

    const res = await backupPost(postWithChunkedStream(chunks))
    expect(res.status).toBe(413)
  }, 30_000)

  it('acepta un backup válido y restaura en la organización del operador', async () => {
    const unique = `BK-${Date.now()}`
    const payload = {
      app: 'CRM ALBRA',
      version: 3,
      exportedAt: new Date().toISOString(),
      organization: { id: 'org-a', name: 'Alpha' },
      data: {
        clients: [{ id: 'old-c1', name: 'Cliente Backup', phone: `+57300${Date.now() % 1000000000}`, status: 'active' }],
        quotes: [{ id: 'old-q1', number: unique, subtotal: 100, tax: 0, total: 100, status: 'draft', clientId: 'old-c1' }],
        quoteItems: [{ id: 'old-i1', quoteId: 'old-q1', description: 'Ítem restaurado', quantity: 2, unitPrice: 50, subtotal: 100 }],
      },
    }
    const res = await backupPost(req('/api/backup', { method: 'POST', token: tokenA(), body: payload }))
    expect(res.status).toBe(200)
    const json = (await jsonBody(res)) as { success: boolean; restored: Record<string, number> }
    expect(json.success).toBe(true)
    expect(json.restored.clients).toBe(1)
    expect(json.restored.quotes).toBe(1)
    expect(json.restored.quoteItems).toBe(1)

    // Todo quedó atribuido a org-a (la org del token), nunca a otra
    const client = await db.client.findFirst({ where: { name: 'Cliente Backup' } })
    expect(client?.organizationId).toBe('org-a')
    const quote = await db.quote.findFirst({ where: { number: unique } })
    expect(quote?.organizationId).toBe('org-a')
    // Limpieza
    if (quote) {
      await db.quoteItem.deleteMany({ where: { quoteId: quote.id } })
      await db.quote.delete({ where: { id: quote.id } })
    }
    if (client) await db.client.delete({ where: { id: client.id } })
  }, 30_000)

  it('rechaza 400 un JSON corrupto y NO restaura nada (todo-o-nada)', async () => {
    const before = await db.client.count({ where: { organizationId: 'org-a' } })
    const corrupted = `{"app":"CRM ALBRA","version":3,"data":{"clients":[{"name":"SemiValido${Date.now()}"}],"quotes":[`
    const bytes = new TextEncoder().encode(corrupted)
    const res = await backupPost(postWithChunkedStream([bytes]))
    expect(res.status).toBe(400)
    const after = await db.client.count({ where: { organizationId: 'org-a' } })
    // ningún cliente debe crearse de un backup corrupto (todo-o-nada)
    expect(after).toBe(before)
  }, 30_000)

  it('rechaza 400 backups de otra aplicación, versiones desconocidas o colecciones no-arreglo', async () => {
    const cases: unknown[] = [
      { app: 'OTRA APP', version: 3, data: {} },
      { app: 'CRM ALBRA', version: 99, data: {} },
      { app: 'CRM ALBRA', version: 3, data: { clients: 'no-soy-arreglo' } },
      { app: 'CRM ALBRA', version: 3 },
    ]
    for (const payload of cases) {
      const bytes = new TextEncoder().encode(JSON.stringify(payload))
      const res = await backupPost(postWithChunkedStream([bytes]))
      expect(res.status).toBe(400)
    }
    // Body no-JSON
    const res = await backupPost(postWithChunkedStream([new TextEncoder().encode('esto no es json')]))
    expect(res.status).toBe(400)
  }, 30_000)
})
