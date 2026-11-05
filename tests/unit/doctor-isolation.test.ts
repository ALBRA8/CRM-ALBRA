/**
 * P0.2 — Aislamiento de ejecuciones (automationRun) del Doctor entre organizaciones.
 *
 * BD de prueba REAL (db/test-vitest.db) + JWT reales firmados con APP_SECRET.
 * Se llama al handler real de /api/doctor: nada de mocks en la lógica bajo prueba
 * (solo se aísla la red: el probe del daemon se stubbea para ser determinista).
 *
 * Contrato verificado:
 *  D1  ?fix=1 de la org A marca SOLO ejecuciones huérfanas de A (escritura
 *      cross-tenant imposible) incluso conociendo los IDs de B.
 *  D2  El conteo de huérfanas que ve cada org es solo el suyo (lectura scoped).
 *  D3  Roles sin permisos de admin (agent/member) → 403.
 *  D4  Anónimo → 401.
 *  D5  El check del daemon reporta la sesión de ESTA org (P0.1), jamás la de
 *      otra; con sesión legado vinculada a otra org → fail explícito.
 *  D6  Parámetros controlados por el cliente (org/organizationId en query)
 *      NO alteran el alcance: la org siempre viene del JWT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { signToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { GET as doctorGET } from '@/app/api/doctor/route'
import { FIX } from '../setup/seed-data'

function tokenFor(userId: string, orgId: string, role: string, email: string): string {
  return signToken({ userId, orgId, role, email }, 1)
}

function doctorRequest(token: string | null, query = ''): NextRequest {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new NextRequest(`http://localhost:3000/api/doctor${query}`, { headers })
}

type Check = { id: string; status: string; data?: Record<string, unknown> }

function findCheck(checks: Check[], id: string): Check | undefined {
  return checks.find((c) => c.id === id)
}

/** Crea una automatización con un run huérfano ('running' iniciado hace 1h). */
async function seedOrphanRun(orgId: string, name: string) {
  const automation = await db.automation.create({
    data: {
      organizationId: orgId,
      name,
      triggerType: 'manual',
      isActive: true,
      actions: JSON.stringify([{ type: 'internal_note', config: { text: 'test' } }]),
    },
  })
  const run = await db.automationRun.create({
    data: {
      organizationId: orgId,
      automationId: automation.id,
      status: 'running',
      startedAt: new Date(Date.now() - 60 * 60_000), // 1h: supera el umbral de 15 min
    },
  })
  return { automation, run }
}

const ORG_A = FIX.orgA.id
const ORG_B = FIX.orgB.id
const OWNER_A = tokenFor(FIX.userA.id, ORG_A, 'owner', FIX.userA.email)

// Determinismo: el probe del daemon se stubbea (la respuesta real depende de
// infraestructura viva). Solo /status del daemon se intercepta.
const realFetch = globalThis.fetch
function stubDaemonStatus(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/status')) {
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return realFetch(input)
    })
  )
}

beforeEach(() => {
  stubDaemonStatus({ status: 'disconnected', sessions: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('P0.2 — Doctor: aislamiento de ejecuciones entre organizaciones', () => {
  it('D1: fix=1 de la org A NO toca la ejecución huérfana de la org B (escritura cross-tenant imposible)', async () => {
    const a = await seedOrphanRun(ORG_A, 'fix-org-a')
    const b = await seedOrphanRun(ORG_B, 'fix-org-b')

    const res = await doctorGET(doctorRequest(OWNER_A, '?fix=1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { organizationId: string; fixed: Record<string, number> }

    // La operación reporta la org del JWT y solo SU ejecución reparada
    expect(body.organizationId).toBe(ORG_A)
    expect(body.fixed.orphanRunsMarkedFailed).toBe(1)

    // EJECUCIÓN DE A: marcada failed por el Doctor
    const runA = await db.automationRun.findUnique({ where: { id: a.run.id } })
    expect(runA?.status).toBe('failed')

    // EJECUCIÓN DE B: INTOCABLE (sigue 'running', sin error, aunque A conoció su ID)
    const runB = await db.automationRun.findUnique({ where: { id: b.run.id } })
    expect(runB?.status).toBe('running')
    expect(runB?.error).toBeNull()
    expect(runB?.finishedAt).toBeNull()

    // Limpieza local del caso (la BD es efímera por archivo, esto evita
    // contaminar los conteos de los tests siguientes)
    await db.automationRun.update({ where: { id: b.run.id }, data: { status: 'failed', error: 'cleanup', finishedAt: new Date() } })
    await db.automation.deleteMany({ where: { id: { in: [a.automation.id, b.automation.id] } } })
  })

  it('D2: cada org solo cuenta sus propias huérfanas (lectura scoped)', async () => {
    // Org B tiene UNA huérfana nueva; org A no tiene ninguna corriendo
    const b = await seedOrphanRun(ORG_B, 'count-org-b')

    const resA = await doctorGET(doctorRequest(OWNER_A))
    expect(resA.status).toBe(200)
    const bodyA = (await resA.json()) as { checks: Check[] }
    const autoA = findCheck(bodyA.checks, 'automations')
    // A NO ve la huérfana de B (antes del fix P0.2 la habría contado)
    expect(autoA?.data?.huerfanas).toBe(0)

    // Owner de B (creado en la BD de prueba) SÍ ve exactamente la suya
    await db.user.create({
      data: {
        id: 'user-b-owner-p02',
        email: 'owner-b-p02@test.albra',
        name: 'Owner Beta P0.2',
        passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128),
        role: 'owner',
        organizationId: ORG_B,
      },
    })
    const tokenB = tokenFor('user-b-owner-p02', ORG_B, 'owner', 'owner-b-p02@test.albra')
    const resB = await doctorGET(doctorRequest(tokenB))
    const bodyB = (await resB.json()) as { checks: Check[] }
    const autoB = findCheck(bodyB.checks, 'automations')
    expect(autoB?.data?.huerfanas).toBe(1)

    await db.automationRun.update({ where: { id: b.run.id }, data: { status: 'failed', error: 'cleanup', finishedAt: new Date() } })
    await db.automation.delete({ where: { id: b.automation.id } })
  })

  it('D3: rol agent/member → 403 (no operan ejecuciones ni ven el diagnóstico)', async () => {
    await db.user.create({
      data: {
        id: 'user-a-agent-p02',
        email: 'agent-a-p02@test.albra',
        name: 'Agent Alfa P0.2',
        passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128),
        role: 'agent',
        organizationId: ORG_A,
      },
    })
    const tokenAgent = tokenFor('user-a-agent-p02', ORG_A, 'agent', 'agent-a-p02@test.albra')
    const resAgent = await doctorGET(doctorRequest(tokenAgent, '?fix=1'))
    expect(resAgent.status).toBe(403)

    const tokenMemberB = tokenFor(FIX.userB.id, ORG_B, 'member', FIX.userB.email)
    const resMember = await doctorGET(doctorRequest(tokenMemberB, '?fix=1'))
    expect(resMember.status).toBe(403)
  })

  it('D4: anónimo → 401', async () => {
    const res = await doctorGET(doctorRequest(null, '?fix=1'))
    expect(res.status).toBe(401)
  })

  it('D5: el daemon reporta la sesión de ESTA org (P0.1), jamás la de otra', async () => {
    // El daemon tiene SOLO la sesión de B conectada: A no debe creérsela
    stubDaemonStatus({ status: 'connected', sessions: [{ orgId: ORG_B, status: 'connected', phone: '+57 300 000 0000' }] })
    const resA = await doctorGET(doctorRequest(OWNER_A))
    const bodyA = (await resA.json()) as { checks: Check[] }
    const waA = findCheck(bodyA.checks, 'whatsapp')
    expect(waA?.status).toBe('ok')
    expect(waA?.data?.orgLinked).toBe(false) // la sesión de B no es de A
    expect(waA?.data?.connection).toBe('disconnected')

    // Para B, esa MISMA respuesta del daemon sí es SU sesión
    const tokenB = tokenFor('user-b-owner-p02', ORG_B, 'owner', 'owner-b-p02@test.albra')
    const resB = await doctorGET(doctorRequest(tokenB))
    const bodyB = (await resB.json()) as { checks: Check[] }
    const waB = findCheck(bodyB.checks, 'whatsapp')
    expect(waB?.data?.orgLinked).toBe(true)
    expect(waB?.data?.connection).toBe('connected')

    // Contrato legado (sin sessions[]): linkedOrgId de otra org → fail explícito
    stubDaemonStatus({ status: 'connected', linkedOrgId: ORG_B })
    const resLegacy = await doctorGET(doctorRequest(OWNER_A))
    const bodyLegacy = (await resLegacy.json()) as { checks: Check[] }
    const waLegacy = findCheck(bodyLegacy.checks, 'whatsapp')
    expect(waLegacy?.status).toBe('fail')
  })

  it('D6: parámetros del cliente (org/organizationId en query) no alteran el alcance', async () => {
    const a = await seedOrphanRun(ORG_A, 'query-org-a')
    const b = await seedOrphanRun(ORG_B, 'query-org-b')

    // El "atacante" intenta dirigir el fix hacia org B desde la query
    const res = await doctorGET(doctorRequest(OWNER_A, '?fix=1&org=org-b&organizationId=org-b'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { organizationId: string; fixed: Record<string, number> }
    expect(body.organizationId).toBe(ORG_A) // el JWT manda
    expect(body.fixed.orphanRunsMarkedFailed).toBe(1)

    const runA = await db.automationRun.findUnique({ where: { id: a.run.id } })
    const runB = await db.automationRun.findUnique({ where: { id: b.run.id } })
    expect(runA?.status).toBe('failed')
    expect(runB?.status).toBe('running') // B sigue intocada

    await db.automationRun.update({ where: { id: b.run.id }, data: { status: 'failed', error: 'cleanup', finishedAt: new Date() } })
    await db.automation.deleteMany({ where: { id: { in: [a.automation.id, b.automation.id] } } })
  })
})
