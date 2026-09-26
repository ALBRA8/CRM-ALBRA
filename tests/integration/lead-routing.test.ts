import { describe, expect, it, beforeAll } from 'vitest'
import { POST as clientsPOST } from '@/app/api/clients/route'
import { assignLeadRoundRobin } from '@/lib/lead-routing'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, tokenA } from '../helpers'

/**
 * Round-robin de leads (Fase 2) — integración contra BD efímera.
 *
 * Escenarios:
 *  - Reparto equilibrado entre usuarios ACTIVOS de la organización.
 *  - Usuarios inactivos quedan fuera del reparto.
 *  - Settings.autoAssignLeads = false → no asigna (toggle por org).
 *  - Org SIN fila de Settings → asigna (default activo).
 *  - Org sin usuarios activos → null sin lanzar.
 *  - Cableado en POST /api/clients: sin assignedToId explícito entra al
 *    round-robin; con assignedToId explícito se respeta la elección humana.
 */

describe('assignLeadRoundRobin — distribución', () => {
  const extra = {
    adminA: { id: 'user-a2', email: 'admin-a@test.albra', name: 'Admin Alfa', passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128), role: 'admin', organizationId: 'org-a' },
    agentA: { id: 'user-a3', email: 'agent-a@test.albra', name: 'Agente Alfa', passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128), role: 'agent', organizationId: 'org-a' },
    agentOff: { id: 'user-a4', email: 'off-a@test.albra', name: 'Agente Inactivo', passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128), role: 'agent', organizationId: 'org-a', isActive: false },
  }

  beforeAll(async () => {
    await db.user.createMany({ data: Object.values(extra) })
    // Toggle encendido para org-a, apagado para org-c (vacía de usuarios)
    await db.settings.create({ data: { organizationId: 'org-a', autoAssignLeads: true } })
    await db.settings.create({ data: { organizationId: 'org-c', autoAssignLeads: false } })
  })

  it('reparte 6 leads entre los 3 activos de org-a: 2 cada uno, sin repetir en seguidilla injusta', async () => {
    const picks: string[] = []
    for (let i = 0; i < 6; i++) {
      const id = await assignLeadRoundRobin('org-a')
      expect(id).toBeTruthy()
      picks.push(id as string)
    }
    const counts = picks.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1
      return acc
    }, {})
    expect(Object.keys(counts).sort()).toEqual([FIX.userA.id, extra.adminA.id, extra.agentA.id].sort())
    for (const id of Object.keys(counts)) expect(counts[id]).toBe(2)
    expect(picks).not.toContain(extra.agentOff.id) // inactivo fuera del reparto

    // Estado persistente: contadores actualizados y lastLeadAt fijado
    const users = await db.user.findMany({
      where: { organizationId: 'org-a', isActive: true },
      select: { id: true, leadCount: true, lastLeadAt: true },
    })
    for (const u of users) {
      expect(u.leadCount).toBe(2)
      expect(u.lastLeadAt).not.toBeNull()
    }
  })

  it('toggle apagado (org-c) → null', async () => {
    expect(await assignLeadRoundRobin('org-c')).toBeNull()
  })

  it('org SIN fila de Settings → default activo (asigna al único activo de org-b)', async () => {
    expect(await assignLeadRoundRobin('org-b')).toBe(FIX.userB.id)
  })

  it('org sin usuarios activos → null sin lanzar', async () => {
    await db.organization.create({ data: { id: 'org-d', name: 'Org D sin equipo', slug: 'test-org-d' } })
    expect(await assignLeadRoundRobin('org-d')).toBeNull()
  })
})

describe('cableado en POST /api/clients', () => {
  beforeAll(async () => {
    // Reutiliza la siembra del describe anterior (mismo archivo → misma BD)
    const existentes = await db.user.count({ where: { organizationId: 'org-a', isActive: true } })
    if (existentes === 0) {
      await db.settings.create({ data: { organizationId: 'org-a', autoAssignLeads: true } })
    }
  })

  it('sin assignedToId explícito → asigna automáticamente por round-robin', async () => {
    const res = await clientsPOST(req('/api/clients', {
      method: 'POST',
      token: tokenA(),
      body: { name: 'Lead Auto', phone: '+573001112233', source: 'whatsapp' },
    }))
    expect(res.status).toBe(201)
    const body = await jsonBody(res)
    const client = body.client as { id: string; assignedToId: string | null } | undefined
      ?? (body as { clients?: Array<{ id: string; assignedToId: string | null }> }).clients?.[0]
    // El contrato exacto de la respuesta depende del serializer; validamos vía BD
    const created = client?.id
      ? await db.client.findUnique({ where: { id: client.id } })
      : await db.client.findFirst({ where: { organizationId: 'org-a', phone: '+573001112233' } })
    expect(created).not.toBeNull()
    expect(created?.assignedToId).toBeTruthy()
    const asignado = await db.user.findFirst({ where: { id: created?.assignedToId ?? '' } })
    expect(asignado?.organizationId).toBe('org-a')
    expect(asignado?.isActive).toBe(true)
  })

  it('con assignedToId explícito → se respeta la elección humana (no re-asigna)', async () => {
    // userB pertenece a org-b: usamos un usuario de org-a para respetar FK lógica
    const elegido = await db.user.findFirst({ where: { organizationId: 'org-a', role: 'owner' } })
    const contadorAntes = elegido?.leadCount ?? 0

    const res = await clientsPOST(req('/api/clients', {
      method: 'POST',
      token: tokenA(),
      body: { name: 'Lead Manual', phone: '+573004445566', assignedToId: elegido?.id },
    }))
    expect(res.status).toBe(201)

    const created = await db.client.findFirst({ where: { organizationId: 'org-a', phone: '+573004445566' } })
    expect(created?.assignedToId).toBe(elegido?.id)
    // La elección manual NO incrementa el contador del round-robin
    const despues = await db.user.findUnique({ where: { id: elegido?.id ?? '' } })
    expect(despues?.leadCount).toBe(contadorAntes)
  })
})
