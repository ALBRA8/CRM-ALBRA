import { afterEach, describe, expect, it } from 'vitest'
import { GET as teamGET, POST as teamPOST } from '@/app/api/team/route'
import { PUT as teamPUT, DELETE as teamDELETE } from '@/app/api/team/[id]/route'
import { GET as clientsGET } from '@/app/api/clients/route'
import { db } from '@/lib/db'
import { FIX, jsonBody, req, routeParams, tokenA, tokenB, tokenFor } from '../helpers'

const createdEmails: string[] = []
const uniqueEmail = () => `team-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`

afterEach(async () => {
  if (createdEmails.length) {
    await db.user.deleteMany({ where: { email: { in: [...createdEmails] } } })
    createdEmails.length = 0
  }
})

describe('multiusuario: límites de organización y ciclo de sesión', () => {
  it('un owner crea miembros solo en su organización e ignora organizationId del body', async () => {
    const email = uniqueEmail()
    createdEmails.push(email)
    const res = await teamPOST(req('/api/team', {
      method: 'POST',
      token: tokenA(),
      body: { name: 'Miembro de prueba', email, password: 'password-segura', role: 'member', organizationId: FIX.orgB.id },
    }))
    expect(res.status).toBe(201)
    const user = await db.user.findUniqueOrThrow({ where: { email } })
    expect(user.organizationId).toBe(FIX.orgA.id)
    expect(user.role).toBe('member')
  })

  it('rechaza contraseñas de menos de 8 caracteres al invitar miembros', async () => {\n    const email = uniqueEmail()\n    const res = await teamPOST(req('/api/team', {\n      method: 'POST', token: tokenA(),\n      body: { name: 'Clave corta', email, password: '1234567' },\n    }))\n    expect(res.status).toBe(400)\n    expect(await db.user.findUnique({ where: { email } })).toBeNull()\n  })\n\n  it('un usuario normal no puede invitar miembros', async () => {
    const email = uniqueEmail()
    createdEmails.push(email)
    const res = await teamPOST(req('/api/team', {
      method: 'POST',
      token: tokenB(),
      body: { name: 'No autorizado', email, password: 'password-segura' },
    }))
    expect(res.status).toBe(403)
    expect(await db.user.findUnique({ where: { email } })).toBeNull()
  })

  it('un rol solicitado superadmin nunca se concede por la API de equipo', async () => {
    const email = uniqueEmail()
    createdEmails.push(email)
    const res = await teamPOST(req('/api/team', {
      method: 'POST',
      token: tokenA(),
      body: { name: 'No plataforma', email, password: 'password-segura', role: 'superadmin' },
    }))
    expect(res.status).toBe(201)
    const user = await db.user.findUniqueOrThrow({ where: { email } })
    expect(user.role).not.toBe('superadmin')
    expect(user.organizationId).toBe(FIX.orgA.id)
  })

  it('el listado de equipo de B no revela miembros de A', async () => {
    const email = uniqueEmail()
    createdEmails.push(email)
    await teamPOST(req('/api/team', {
      method: 'POST',
      token: tokenA(),
      body: { name: 'Solo org A', email, password: 'password-segura' },
    }))
    const res = await teamGET(req('/api/team', { token: tokenB() }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const members = body.members as Array<{ email: string }>
    expect(members.some((member) => member.email === email)).toBe(false)
  })

  it('PUT y DELETE de un miembro de otra organización devuelven 404', async () => {
    const email = uniqueEmail()
    createdEmails.push(email)
    await teamPOST(req('/api/team', {
      method: 'POST',
      token: tokenA(),
      body: { name: 'Miembro privado A', email, password: 'password-segura' },
    }))
    const member = await db.user.findUniqueOrThrow({ where: { email } })

    const update = await teamPUT(req(`/api/team/${member.id}`, {
      method: 'PUT', token: tokenB(), body: { name: 'Intrusión' },
    }), routeParams(member.id))
    expect(update.status).toBe(404)

    const remove = await teamDELETE(req(`/api/team/${member.id}`, {
      method: 'DELETE', token: tokenB(),
    }), routeParams(member.id))
    expect(remove.status).toBe(404)
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).isActive).toBe(true)
  })

  it('un cambio de rol invalida inmediatamente el JWT anterior', async () => {
    const email = uniqueEmail()
    createdEmails.push(email)
    await teamPOST(req('/api/team', {
      method: 'POST',
      token: tokenA(),
      body: { name: 'Cambio de rol', email, password: 'password-segura', role: 'member' },
    }))
    const member = await db.user.findUniqueOrThrow({ where: { email } })
    const staleToken = tokenFor({
      id: member.id, email: member.email, role: member.role, organizationId: member.organizationId,
    })

    const update = await teamPUT(req(`/api/team/${member.id}`, {
      method: 'PUT', token: tokenA(), body: { role: 'agent' },
    }), routeParams(member.id))
    expect(update.status).toBe(200)

    const staleSession = await clientsGET(req('/api/clients', { token: staleToken }))
    expect(staleSession.status).toBe(401)
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).tokenVersion).toBe(member.tokenVersion + 1)
  })
})
