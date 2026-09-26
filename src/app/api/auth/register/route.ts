import type { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword, signToken, slugify, HttpError } from '@/lib/auth'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../_lib/shared'
import { createStandardPipeline, createOrgSettings } from '../../_lib/demo-seed'

/** POST /api/auth/register — crea Organization + User owner + semillas básicas. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readBody(req)
    requireFields(body, ['name', 'email', 'password'])

    const name = str(body.name) as string
    const email = (str(body.email) as string).toLowerCase()
    const password = str(body.password) as string
    const company = str(body.company)
    const phone = str(body.phone)

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email inválido')
    if (password.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres')

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) throw new HttpError(409, 'Ya existe una cuenta con este email')

    // Slug único: slugify(name) + sufijo corto si colisiona
    const orgName = company ?? name
    const base = slugify(orgName)
    let slug = base
    for (let i = 0; i < 5; i++) {
      const taken = await db.organization.findUnique({ where: { slug }, select: { id: true } })
      if (!taken) break
      slug = `${base}-${randomBytes(2).toString('hex')}`
    }

    const org = await db.organization.create({ data: { name: orgName, slug } })
    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash: hashPassword(password),
        company,
        phone,
        role: 'owner',
        organizationId: org.id,
      },
    })

    await createStandardPipeline(org.id)
    await createOrgSettings(org.id)

    const token = signToken({ userId: user.id, orgId: org.id, role: user.role, email: user.email })
    return jsonWithSession({
      token,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
