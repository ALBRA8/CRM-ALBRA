/**
 * B1 — Aislamiento de referencias históricas cross-org en /api/dashboard.
 *
 * BD de prueba REAL (db/test-vitest.db) + JWT real firmado con APP_SECRET.
 * Se llama al handler real de /api/dashboard: nada de mocks en la lógica bajo
 * prueba.
 *
 * Problema reproducido: relaciones creadas antes del endurecido multi-tenant
 * pueden apuntar (por FK de id) a un cliente de OTRA organización. El include
 * de Prisma sigue la FK y serializa nombre/email/teléfono ajenos en la
 * respuesta del dashboard.
 *
 * Contrato verificado:
 *  B1.1  La reserva próxima de A que apunta a un cliente de B NO expone el
 *        nombre/email/teléfono de ese cliente (ninguna sección de la respuesta).
 *  B1.2  La oportunidad de A que apunta a un cliente de B queda excluida de
 *        clientsNeedingFollowUp (y de cualquier nombre en la respuesta).
 *  B1.3  El evento de timeline de A con clientId foráneo no expone el cliente
 *        (ni id foráneo ni nombre).
 *  B1.4  No hay sobre-eliminación: las referencias legítimas de la propia org
 *        (clientA1) siguen apareciendo con su nombre.
 *  B1.5  Los agregados propios de la org (totalOpportunities) no cambian: se
 *        elimina la REFERENCIA foránea, no el dato de la propia org.
 */
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { signToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { GET as dashboardGET } from '@/app/api/dashboard/route'
import { FIX } from '../setup/seed-data'

const ORG_A = FIX.orgA.id
const ORG_B = FIX.orgB.id

function tokenFor(userId: string, orgId: string, role: string, email: string): string {
  return signToken({ userId, orgId, role, email }, 1)
}

function dashboardRequest(token: string): NextRequest {
  const headers = new Headers()
  headers.set('authorization', `Bearer ${token}`)
  return new NextRequest('http://localhost:3000/api/dashboard', { headers })
}

type DashboardBody = {
  totalOpportunities: number
  upcomingReservations: Array<{ title: string; client?: { id: string; name: string } | null }>
  clientsNeedingFollowUp: Array<{ id: string; client: { id: string; name: string } }>
  recentActivity: Array<{ content: string; client?: { id: string; name: string } | null }>
}

/** Siembra referencias históricas inconsistentes: filas de A apuntando a un cliente de B. */
async function seedCrossOrgRefs() {
  const in2Days = new Date(Date.now() + 2 * 86_400_000)
  const in3Days = new Date(Date.now() + 3 * 86_400_000)

  // Referencias FORÁNEAS (historia inconsistente: fila de org A → cliente de org B)
  const oppForeign = await db.opportunity.create({
    data: {
      organizationId: ORG_A,
      title: 'Opp cross-org',
      clientId: FIX.clientB1.id, // cliente de ORG_B
      amount: 500,
      status: 'open',
    },
  })
  const resvForeign = await db.reservation.create({
    data: {
      organizationId: ORG_A,
      title: 'Reserva cross-org',
      clientId: FIX.clientB1.id, // cliente de ORG_B
      startsAt: in2Days,
      status: 'scheduled',
    },
  })
  const tlForeign = await db.timelineEvent.create({
    data: {
      organizationId: ORG_A,
      type: 'note',
      title: 'Evento cross-org',
      clientId: FIX.clientB1.id, // cliente de ORG_B
    },
  })

  // Referencias legítimas de la propia org (NO deben ser eliminadas)
  const oppOwn = await db.opportunity.create({
    data: { organizationId: ORG_A, title: 'Opp propia', clientId: FIX.clientA1.id, amount: 100, status: 'open' },
  })
  const resvOwn = await db.reservation.create({
    data: {
      organizationId: ORG_A,
      title: 'Reserva propia',
      clientId: FIX.clientA1.id,
      startsAt: in3Days,
      status: 'scheduled',
    },
  })

  return { oppForeign, resvForeign, tlForeign, oppOwn, resvOwn }
}

describe('B1 — Dashboard: aislamiento de referencias históricas cross-org', () => {
  it('B1.1–B1.5: un cliente de otra organización nunca aparece en la respuesta del dashboard', async () => {
    const seeded = await seedCrossOrgRefs()
    const token = tokenFor(FIX.userA.id, ORG_A, 'owner', FIX.userA.email)

    const res = await dashboardGET(dashboardRequest(token))
    expect(res.status).toBe(200)
    const body = (await res.json()) as DashboardBody

    // ---- B1.1: la reserva cross-org no expone al cliente de B
    const foreignResv = body.upcomingReservations.find((r) => r.title === 'Reserva cross-org')
    expect(foreignResv).toBeDefined()
    expect(foreignResv?.client).toBeUndefined()

    // ---- B1.2: la oportunidad cross-org queda fuera del seguimiento
    const followUpIds = body.clientsNeedingFollowUp.map((c) => c.id)
    expect(followUpIds).not.toContain(seeded.oppForeign.id)

    // ---- B1.3: el evento cross-org no expone cliente (ni id foráneo)
    // recentActivity serializa el título en `content` (title — description)
    const foreignEvent = body.recentActivity.find((e) => e.content.includes('Evento cross-org'))
    expect(foreignEvent).toBeDefined()
    expect(foreignEvent?.client).toBeUndefined()

    // ---- B1.4: SIN sobre-eliminación — las referencias propias siguen visibles
    const ownResv = body.upcomingReservations.find((r) => r.title === 'Reserva propia')
    expect(ownResv?.client?.id).toBe(FIX.clientA1.id)
    expect(ownResv?.client?.name).toBe(FIX.clientA1.name)
    const ownOpp = body.clientsNeedingFollowUp.find((c) => c.id === seeded.oppOwn.id)
    expect(ownOpp?.client.name).toBe(FIX.clientA1.name)

    // ---- B1.5: los agregados propios no cambian (se elimina la referencia, no el dato)
    expect(body.totalOpportunities).toBe(2)

    // ---- Barrido global: ni el nombre ni el email del cliente de B en NINGÚN punto
    const raw = JSON.stringify(body)
    expect(raw).not.toContain(FIX.clientB1.name)
    expect(raw).not.toContain(FIX.clientB1.email)
    expect(raw).not.toContain(FIX.clientB1.id)

    // Limpieza (BD efímera por archivo: evita contaminar otros casos)
    await db.opportunity.deleteMany({ where: { id: { in: [seeded.oppForeign.id, seeded.oppOwn.id] } } })
    await db.reservation.deleteMany({ where: { id: { in: [seeded.resvForeign.id, seeded.resvOwn.id] } } })
    await db.timelineEvent.delete({ where: { id: seeded.tlForeign.id } })
  })
})
