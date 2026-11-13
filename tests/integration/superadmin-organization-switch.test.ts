import { describe, expect, it } from 'vitest'
import { POST as switchOrganization } from '@/app/api/super/switch-organization/route'
import { GET as clientsGET } from '@/app/api/clients/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, tokenFor, tokenB } from '../helpers'

describe('superadmin: cambio de contexto entre organizaciones', () => {
  it('permite al superadmin cambiar a otra organización sin alterar la membresía base', async () => {
    const original = await db.user.findUniqueOrThrow({ where: { id: FIX.userA.id } })
    await db.user.update({ where: { id: FIX.userA.id }, data: { role: 'superadmin' } })

    try {
      const platformToken = tokenFor({ ...FIX.userA, role: 'superadmin' })
      const switched = await switchOrganization(req('/api/super/switch-organization', {
        token: platformToken,
        method: 'POST',
        body: { organizationId: FIX.orgB.id },
      }))
      expect(switched.status).toBe(200)
      const payload = await jsonBody(switched)
      expect(payload.organization).toMatchObject({ id: FIX.orgB.id, name: FIX.orgB.name })
      expect(typeof payload.token).toBe('string')

      const clients = await clientsGET(req('/api/clients', { token: payload.token as string }))
      expect(clients.status).toBe(200)
      const body = await jsonBody(clients)
      expect((body.clients as Array<{ id: string }>).map((client) => client.id)).toContain(FIX.clientB1.id)

      const unchanged = await db.user.findUniqueOrThrow({ where: { id: FIX.userA.id } })
      expect(unchanged.organizationId).toBe(FIX.orgA.id)
      expect(unchanged.role).toBe('superadmin')
    } finally {
      await db.user.update({
        where: { id: FIX.userA.id },
        data: { role: original.role, tokenVersion: original.tokenVersion },
      })
    }
  })

  it('un usuario normal no puede cambiar de organización', async () => {
    const res = await switchOrganization(req('/api/super/switch-organization', {
      token: tokenB(),
      method: 'POST',
      body: { organizationId: FIX.orgA.id },
    }))
    expect(res.status).toBe(403)
  })

  it('rechaza organizaciones inactivas o inexistentes', async () => {
    const original = await db.user.findUniqueOrThrow({ where: { id: FIX.userA.id } })
    await db.user.update({ where: { id: FIX.userA.id }, data: { role: 'superadmin' } })
    try {
      const token = tokenFor({ ...FIX.userA, role: 'superadmin' })
      const missing = await switchOrganization(req('/api/super/switch-organization', {
        token, method: 'POST', body: { organizationId: 'no-such-org' },
      }))
      expect(missing.status).toBe(404)
    } finally {
      await db.user.update({
        where: { id: FIX.userA.id },
        data: { role: original.role, tokenVersion: original.tokenVersion },
      })
    }
  })
})
