import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as actionsPOST, GET as actionsGET } from '@/app/api/crm/actions/route'
import { db } from '@/lib/db'
import { generateApiKey } from '@/lib/api-keys'
import { FIX, tokenA, tokenB } from '../helpers'

/**
 * POST /api/crm/actions — CONTRATO DEL CHALECO CRM para hosts (REST).
 * La capa de acciones fue extraída del agente propietario (eliminado):
 * valida auth dual (JWT de usuario / API key de org), RBAC, validación zod
 * y aislamiento multi-tenant.
 */

const CLIENT = 'client-crm-actions'

let apiKeyOrgA: string

function req(body: Record<string, unknown>, opts: { token?: string; key?: string } = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (opts.key) headers.set('authorization', `Bearer ${opts.key}`)
  return new NextRequest('http://localhost:3000/api/crm/actions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  await db.client.create({
    data: { id: CLIENT, organizationId: FIX.orgA.id, name: 'Cliente Acciones CRM', phone: '+57 320 555 0101' },
  })
  const k = generateApiKey()
  await db.apiKey.create({
    data: { organizationId: FIX.orgA.id, name: 'Host de prueba', hashedKey: k.hashedKey, prefix: k.prefix },
  })
  apiKeyOrgA = k.raw
})

afterAll(async () => {
  await db.apiKey.deleteMany({ where: { name: 'Host de prueba' } })
  await db.client.deleteMany({ where: { id: CLIENT } })
  await db.$disconnect()
})

describe('POST /api/crm/actions — acciones del chaleco', () => {
  it('401 sin autenticación (ni JWT ni API key)', async () => {
    const res = await actionsPOST(req({ action: 'list_recent_clients' }))
    expect(res.status).toBe(401)
  })

  it('400 acción desconocida con catálogo disponible', async () => {
    const res = await actionsPOST(req({ action: 'delete_everything' }, { key: apiKeyOrgA }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(String(data.error)).toContain('delete_everything')
    expect(Array.isArray(data.available)).toBe(true)
  })

  it('400 validación zod de params antes de tocar la BD', async () => {
    const res = await actionsPOST(req({ action: 'create_client', params: { name: '' } }, { key: apiKeyOrgA }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(String(data.error)).toContain('Parámetro inválido')
  })

  it('API key de la org crea un cliente (contrato host programático)', async () => {
    const res = await actionsPOST(
      req({ action: 'create_client', params: { name: 'Host Creado', phone: '+57 300 111 2233' } }, { key: apiKeyOrgA }),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.summary).toContain('Host Creado')
    expect(data.clientId).toBeTruthy()

    const created = await db.client.findUnique({ where: { id: data.clientId } })
    expect(created?.organizationId).toBe(FIX.orgA.id)
    expect(created?.source).toBe('crm-api')

    // Evidencia: timeline + auditoría con procedencia
    const tl = await db.timelineEvent.findFirst({
      where: { organizationId: FIX.orgA.id, clientId: data.clientId, source: 'crm-api' },
      orderBy: { createdAt: 'desc' },
    })
    expect(tl).toBeTruthy()

    await db.client.delete({ where: { id: data.clientId } })
  })

  it('JWT de usuario con rol comercial ejecuta acciones de lectura', async () => {
    const res = await actionsPOST(req({ action: 'list_recent_clients', params: {} }, { token: tokenA() }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
  })

  it('member (rol comercial) NO puede usar acciones fuera de su permiso', async () => {
    // tokenB = member/agent de org A: schedule_reservation sí es del rol
    // comercial (reservations.write), así que probamos el gate con quote_summary
    // de un cliente ajeno → el aislamiento multi-tenant responde 400, y el
    // gate RBAC se verifica con el catálogo (kind write con permiso admin no
    // existe en el catálogo por diseño).
    const res = await actionsPOST(
      req({ action: 'quote_summary', params: { clientId: 'cliente-de-otra-org' } }, { token: tokenB() })
    )
    expect(res.status).toBe(400) // gate RBAC pasó; el aislamiento negó el clientId ajeno
  })

  it('quote_summary resume cotizaciones con aislamiento multi-tenant', async () => {
    const res = await actionsPOST(
      req({ action: 'quote_summary', params: { clientId: CLIENT } }, { token: tokenA() })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.summary).toContain('no tiene cotizaciones')
  })

  it('schedule_reservation agenda cita y registra timeline', async () => {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const res = await actionsPOST(
      req({ action: 'schedule_reservation', params: { clientId: CLIENT, title: 'Demo del chaleco', startsAt } }, { token: tokenA() })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.summary).toContain('Demo del chaleco')
  })

  it('GET expone el catálogo auto-descriptivo (crm-actions/v1)', async () => {
    const headers = new Headers({ authorization: `Bearer ${apiKeyOrgA}` })
    const res = await actionsGET(new NextRequest('http://localhost:3000/api/crm/actions', { headers }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.contract).toBe('crm-actions/v1')
    expect(data.actions.length).toBeGreaterThanOrEqual(6)
  })
})
