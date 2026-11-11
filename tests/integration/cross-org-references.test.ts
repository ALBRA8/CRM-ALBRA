import { describe, expect, it, beforeEach } from 'vitest'
import { POST as clientsPOST } from '@/app/api/clients/route'
import { PUT as clientsPUT } from '@/app/api/clients/[id]/route'
import { POST as opportunitiesPOST } from '@/app/api/opportunities/route'
import { POST as transactionsPOST } from '@/app/api/transactions/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, routeParams, tokenFor } from '../helpers'

/**
 * Integridad referencial ENTRE organizaciones (segunda reparación — orden §2.B/§6).
 * "Usuario de una organización intenta referenciar datos de otra" → rechazado.
 */

const A = () => tokenFor(FIX.userA) // owner org-a
const B = () => tokenFor(FIX.userB) // member org-b

let userOfOrgB = ''
let quoteOfOrgA = ''

beforeEach(async () => {
  // Asegura un usuario real de la org B y una cotización real de la org A
  const uB = await db.user.upsert({
    where: { email: 'member-b@refs.test' },
    update: {},
    create: { email: 'member-b@refs.test', name: 'Member B', passwordHash: 'scrypt:aa:bb', role: 'member', organizationId: FIX.userB.organizationId },
  })
  userOfOrgB = uB.id
  await db.quote.deleteMany({ where: { organizationId: FIX.orgA.id, number: 'COT-REF' } })
  const q = await db.quote.create({
    data: { organizationId: FIX.orgA.id, number: 'COT-REF', clientId: FIX.clientA1.id, subtotal: 10, tax: 0, total: 10 },
  })
  quoteOfOrgA = q.id
})

describe('referencias cruzadas entre organizaciones rechazadas', () => {
  it('cliente de org A NO puede asignarse a un usuario de org B (assignedToId)', async () => {
    const res = await clientsPOST(req('/api/clients', { method: 'POST', token: A(), body: { name: 'X', phone: '3001112222', assignedToId: userOfOrgB } }))
    expect(res.status).toBe(400)
    expect(String((await jsonBody(res)).error)).toMatch(/organización/i)
    // Y el PUT tampoco
    const put = await clientsPUT(req(`/api/clients/${FIX.clientA1.id}`, { method: 'PUT', token: A(), body: { assignedToId: userOfOrgB } }), routeParams(FIX.clientA1.id))
    expect(put.status).toBe(400)
  })

  it('oportunidad de org A NO puede asignarse a un usuario de org B', async () => {
    const res = await opportunitiesPOST(req('/api/opportunities', { method: 'POST', token: A(), body: { title: 'Opp', clientId: FIX.clientA1.id, assignedToId: userOfOrgB } }))
    expect(res.status).toBe(400)
  })

  it('transacción de org A NO puede referenciar datos inexistentes de otra org', async () => {
    const res = await transactionsPOST(req('/api/transactions', { method: 'POST', token: A(), body: { type: 'ingreso', amount: 5, quoteId: 'no-existe-en-ninguna-org' } }))
    expect(res.status).toBe(400)
  })

  it('una transacción SÍ puede referenciar una cotización de su propia org', async () => {
    const res = await transactionsPOST(req('/api/transactions', { method: 'POST', token: A(), body: { type: 'ingreso', amount: 10, description: 'Cobro', quoteId: quoteOfOrgA } }))
    expect(res.status).toBe(201)
    const { transaction } = (await jsonBody(res)) as { transaction: { quoteId: string | null } }
    expect(transaction.quoteId).toBe(quoteOfOrgA)
  })
})
