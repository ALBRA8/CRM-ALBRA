import { describe, expect, it, beforeEach } from 'vitest'
import { GET as opportunitiesGET } from '@/app/api/opportunities/route'
import { GET as opportunityGET } from '@/app/api/opportunities/[id]/route'
import { GET as quotesGET } from '@/app/api/quotes/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, routeParams, tokenFor } from '../helpers'

/**
 * CUARTA FASE CORRECTIVA — REFERENCIAS HISTÓRICAS ENTRE ORGANIZACIONES.
 * Datos históricos inconsistentes (NO producibles por la API: p. ej. una
 * oportunidad antigua cuyo clientId apunta a un cliente de OTRA organización)
 * no deben filtrar datos personales de la otra org por las lecturas auxiliares
 * (nombre/email/teléfono incluidos con la relación `client`).
 * Estado esperado: la relación se elimina del resultado (client: null); el
 * clientId propio (referencia histórica de la propia org) se conserva.
 */

const A = () => tokenFor(FIX.userA)

let historicalOppId = ''

beforeEach(async () => {
  // Limpia y crea la referencia histórica inconsistente directamente en BD
  await db.opportunity.deleteMany({ where: { organizationId: FIX.orgA.id, title: 'OPP-HISTORICA-CRUZADA' } })
  const opp = await db.opportunity.create({
    data: {
      organizationId: FIX.orgA.id,
      title: 'OPP-HISTORICA-CRUZADA',
      clientId: FIX.clientB1.id, // cliente de la ORG B — inconsistencia histórica
      amount: 100,
      probability: 50,
      status: 'open',
    },
  })
  historicalOppId = opp.id

  // Y una oportunidad SANA (cliente de la propia org A) para verificar que no
  // se sobre-bloquea el caso legítimo.
  await db.opportunity.deleteMany({ where: { organizationId: FIX.orgA.id, title: 'OPP-HISTORICA-SANA' } })
  await db.opportunity.create({
    data: {
      organizationId: FIX.orgA.id,
      title: 'OPP-HISTORICA-SANA',
      clientId: FIX.clientA1.id,
      amount: 200,
      probability: 50,
      status: 'open',
    },
  })
})

describe('referencias históricas inconsistentes: cero filtración cruzada', () => {
  it('el listado de oportunidades NO expone PII del cliente de otra org', async () => {
    const res = await opportunitiesGET(req('/api/opportunities', { method: 'GET', token: A() }))
    expect(res.status).toBe(200)
    const body = (await jsonBody(res)) as { opportunities: Array<{ title: string; client: { name: string } | null }> }
    const raw = JSON.stringify(body)
    expect(raw).not.toContain(FIX.clientB1.name)
    expect(raw).not.toContain(String(FIX.clientB1.email))

    // La oportunidad histórica SÍ aparece (es de la org A), pero sin el cliente ajeno
    const opp = body.opportunities.find((o: { title: string }) => o.title === 'OPP-HISTORICA-CRUZADA')
    expect(opp).toBeTruthy()
    expect(opp!.client).toBeNull()
    // El caso sano conserva SU cliente completo
    const sane = body.opportunities.find((o: { title: string }) => o.title === 'OPP-HISTORICA-SANA')
    expect(sane).toBeTruthy()
    expect(sane!.client).toBeTruthy()
    expect(sane!.client!.name).toBe(FIX.clientA1.name)
  })

  it('el detalle de la oportunidad histórica NO expone PII del cliente ajeno', async () => {
    const res = await opportunityGET(req(`/api/opportunities/${historicalOppId}`, { method: 'GET', token: A() }), routeParams(historicalOppId))
    expect(res.status).toBe(200)
    const raw = JSON.stringify(await jsonBody(res))
    expect(raw).not.toContain(FIX.clientB1.name)
    expect(raw).not.toContain(String(FIX.clientB1.email))
  })

  it('el listado de cotizaciones tampoco filtra el cliente ajeno por la relación incluida', async () => {
    // Referencia histórica en quotes: cotización de org A con cliente de org B
    await db.quote.deleteMany({ where: { organizationId: FIX.orgA.id, number: 'COT-HIST-CRUZADA' } })
    await db.quote.create({
      data: { organizationId: FIX.orgA.id, number: 'COT-HIST-CRUZADA', clientId: FIX.clientB1.id, subtotal: 10, tax: 0, total: 10 },
    })
    const res = await quotesGET(req('/api/quotes', { method: 'GET', token: A() }))
    expect(res.status).toBe(200)
    const raw = JSON.stringify(await jsonBody(res))
    expect(raw).not.toContain(FIX.clientB1.name)
    expect(raw).not.toContain(String(FIX.clientB1.email))
  })
})
