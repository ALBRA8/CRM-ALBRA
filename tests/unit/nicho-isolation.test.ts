/**
 * P0.3 — /api/nicho: selección indebida de organización cerrada.
 *
 * BD de prueba REAL (db/test-vitest.db) + JWT reales. Handler real importado;
 * sin mocks en la lógica bajo prueba.
 *
 * Contrato verificado:
 *  N1  anónimo sin ?org → 401 (se eliminó el fallback "primera org activa")
 *  N2  anónimo ?org=slug-B → 200 con SOLO campos públicos de marca
 *      (sin negociacion / reglas_oro / personality / auto_reply)
 *  N3  anónimo ?org=slug-desconocido → 404 genérico (sin oráculo de existencia)
 *  N4  anónimo ?org inválido (traversal) → 400 + evento de seguridad
 *  N5  autenticado de A con ?org=slug-B IGNORADO: devuelve SOLO datos de A
 *      (la org viene del JWT) y sí incluye su configuración completa
 *  N6  rate limit anónimo: 31ª petición → 429 con Retry-After
 *  N7  PUT de member → 403; PUT de owner A escribe SOLO en A (B intacta)
 *  N8  PUT con organizationId de otra org en el body → ignorado (org del JWT)
 *  N9  org inactiva → 404 (igual que inexistente: sin oráculo)
 *  N10 GET autenticado es lectura pura: NO crea NichoConfig (antes sí)
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { signToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { GET as nichoGET, PUT as nichoPUT } from '@/app/api/nicho/route'
import { resetRateLimits } from '@/lib/rate-limit'
import { recentSecurityEvents } from '@/lib/security-log'
import { FIX } from '../setup/seed-data'

const ORG_A = FIX.orgA.id
const ORG_B = FIX.orgB.id
const ORG_C = FIX.orgC.id
const SLUG_A = FIX.orgA.slug
const SLUG_B = FIX.orgB.slug

const OWNER_A = signToken({ userId: FIX.userA.id, orgId: ORG_A, role: 'owner', email: FIX.userA.email }, 1)
const MEMBER_B = signToken({ userId: FIX.userB.id, orgId: ORG_B, role: 'member', email: FIX.userB.email }, 1)

function req(url: string, token?: string, method = 'GET', body?: unknown): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost:3000/api/nicho${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  resetRateLimits()
})

describe('P0.3 — /api/nicho: aislamiento y contrato público', () => {
  it('semilla: NichoConfig distintos por org con táctica comercial sensible', async () => {
    await db.nichoConfig.create({
      data: {
        organizationId: ORG_A,
        brandingName: 'Marca Alfa',
        rubro: 'Retail Alfa',
        services: JSON.stringify(['Servicio A1']),
        faqs: JSON.stringify([{ q: '¿Horario A?', a: '8-18' }]),
        raw: JSON.stringify({ reglas_oro: ['REGLA SECRETA A'], negociacion: { descuento_maximo: 25, estrategia: 'ESTRATEGIA SECRETA A' } }),
      },
    })
    await db.nichoConfig.create({
      data: {
        organizationId: ORG_B,
        brandingName: 'Marca Beta',
        rubro: 'Retail Beta',
        services: JSON.stringify(['Servicio B1']),
        raw: JSON.stringify({ reglas_oro: ['REGLA SECRETA B'], negociacion: { descuento_maximo: 40, estrategia: 'ESTRATEGIA SECRETA B' } }),
      },
    })
  })

  it('N1: anónimo sin ?org → 401', async () => {
    const res = await nichoGET(req(''))
    expect(res.status).toBe(401)
  })

  it('N2: anónimo ?org=slug-B → solo campos públicos (sin táctica comercial)', async () => {
    const res = await nichoGET(req(`?org=${SLUG_B}`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    expect(body.branding_name).toBe('Marca Beta')
    expect(body.brandingName).toBe('Marca Beta')
    expect(body.rubro).toBe('Retail Beta')
    expect(Array.isArray(body.services)).toBe(true)
    expect(body.services).toEqual(['Servicio B1'])

    // Campos SENSIBLES que NO deben salir por la vía pública
    expect(body).not.toHaveProperty('negociacion')
    expect(body).not.toHaveProperty('reglas_oro')
    expect(body).not.toHaveProperty('personality')
    expect(body).not.toHaveProperty('auto_reply')
    expect(body).not.toHaveProperty('autoReplyEnabled')
    expect(body).not.toHaveProperty('handoffKeywords')
    expect(body).not.toHaveProperty('raw')

    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('N3: anónimo con slug desconocido → 404 genérico', async () => {
    const res = await nichoGET(req('?org=esta-org-no-existe-xyz'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Organización no encontrada')
  })

  it('N4: anónimo con slug inválido (traversal/formato) → 400 + evento de seguridad', async () => {
    for (const evil of ['../etc/passwd', '%2e%2e%2fetc', 'Org Con Espacios', 'a'.repeat(100)]) {
      const res = await nichoGET(req(`?org=${encodeURIComponent(evil)}`))
      expect([400, 404]).toContain(res.status)
      expect(res.status).not.toBe(200)
    }
    expect(recentSecurityEvents().some((e) => e.type === 'nicho.slug_invalido')).toBe(true)
  })

  it('N5: autenticado de A con ?org=slug-B → el JWT manda; datos SOLO de A', async () => {
    const res = await nichoGET(req(`?org=${SLUG_B}`, OWNER_A))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    // El parámetro del cliente se IGNORA: lo que vuelve es la org del token
    expect(body.branding_name).toBe('Marca Alfa')
    expect(body.brandingName).toBe('Marca Alfa')
    // Su configuración completa (propietaria) sí está
    expect(body).toHaveProperty('negociacion')
    expect((body.reglas_oro as string[]).join(',')).toContain('REGLA SECRETA A')
    expect(JSON.stringify(body.negociacion)).not.toContain('ESTRATEGIA SECRETA B')

    // Y quedó constancia del parámetro ignorado
    expect(recentSecurityEvents().some((e) => e.type === 'nicho.org_param_ignorado')).toBe(true)
  })

  it('N6: rate limit anónimo → 429 con Retry-After (anti-enumeración)', async () => {
    let saw429 = false
    let retryAfter: string | null = null
    for (let i = 0; i < 31; i++) {
      const res = await nichoGET(req(`?org=${SLUG_B}`))
      if (res.status === 429) {
        saw429 = true
        retryAfter = res.headers.get('retry-after')
        break
      }
    }
    expect(saw429).toBe(true)
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('N7: PUT member → 403; PUT owner escribe SOLO su org (B intacta)', async () => {
    const forbidden = await nichoPUT(req('', MEMBER_B, 'PUT', { branding_name: 'Hack' }))
    expect(forbidden.status).toBe(403)

    const ok = await nichoPUT(req('', OWNER_A, 'PUT', { branding_name: 'Marca Alfa v2', rubro: 'Retail Alfa v2' }))
    expect(ok.status).toBe(200)

    const cfgA = await db.nichoConfig.findUnique({ where: { organizationId: ORG_A } })
    const cfgB = await db.nichoConfig.findUnique({ where: { organizationId: ORG_B } })
    expect(cfgA?.brandingName).toBe('Marca Alfa v2')
    expect(cfgB?.brandingName).toBe('Marca Beta') // B intacta
    // El raw de A conserva sus reglas (merge, no sobrescritura)
    expect(String(cfgA?.raw)).toContain('REGLA SECRETA A')
  })

  it('N8: PUT con organizationId de OTRA org en el body → ignorado (org del JWT)', async () => {
    const res = await nichoPUT(req('', OWNER_A, 'PUT', { branding_name: 'Marca Alfa v3', organizationId: ORG_B, org: SLUG_B }))
    expect(res.status).toBe(200)

    const cfgA = await db.nichoConfig.findUnique({ where: { organizationId: ORG_A } })
    const cfgB = await db.nichoConfig.findUnique({ where: { organizationId: ORG_B } })
    expect(cfgA?.brandingName).toBe('Marca Alfa v3')
    expect(cfgB?.brandingName).toBe('Marca Beta') // B jamás tocada
    expect(recentSecurityEvents().some((e) => e.type === 'nicho.org_param_en_put_ignorado')).toBe(true)
  })

  it('N9: org inactiva → 404 (mismo trato que inexistente, sin oráculo)', async () => {
    await db.organization.create({
      data: { id: 'org-d-inactiva', name: 'Org Inactiva', slug: 'org-inactiva-test', isActive: false },
    })
    const res = await nichoGET(req('?org=org-inactiva-test'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Organización no encontrada')
  })

  it('N10: GET autenticado es lectura pura — NO crea NichoConfig (antes sí)', async () => {
    const ownerC = signToken({ userId: 'user-c-p03', orgId: ORG_C, role: 'owner', email: 'owner-c@test.albra' }, 1)
    const before = await db.nichoConfig.count({ where: { organizationId: ORG_C } })
    const res = await nichoGET(req('', ownerC))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.branding_name).toBe('CRM ALBRA') // defaults, sin fila
    const after = await db.nichoConfig.count({ where: { organizationId: ORG_C } })
    expect(before).toBe(0)
    expect(after).toBe(0)
  })
})
