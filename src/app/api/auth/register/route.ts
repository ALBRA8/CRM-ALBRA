import type { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword, signToken, slugify, HttpError } from '@/lib/auth'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../_lib/shared'
import { createStandardPipeline, createOrgSettings } from '../../_lib/demo-seed'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'

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
    // (A2-06, auditoría 2026-11-11) mínimo 8 (antes 6 — inconsistente con
    // reset-password) + creación de organizaciones con límite durable por IP
    // (el registro crea Organization+User+pipeline: vector de spam de tenants).
    if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres')
    const regRl = await dbRateLimit(`register:${clientIp(req)}`, 20, 60 * 60 * 1000)
    if (!regRl.ok) throw new HttpError(429, 'Demasiados registros desde esta IP. Inténtalo más tarde.')

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

    // (A4-07, auditoría 2026-11-11) Transacción atómica: un fallo a mitad ya
    // NO deja organización huérfana sin owner, ni owner sin pipeline/settings.
    // (A4-07, auditoría 2026-11-11) Transacción atómica del NÚCLEO org+user:
    // un fallo a mitad ya NO deja organización huérfana sin owner. Pipeline y
    // settings se crean a continuación (usan el cliente global; su ausencia
    // ante un fallo posterior es recuperable y no rompe integridad).
    const { org, user } = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: orgName, slug } })
      const user = await tx.user.create({
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
      return { org, user }
    })

    await createStandardPipeline(org.id)
    await createOrgSettings(org.id)

    const token = signToken({ userId: user.id, orgId: org.id, role: user.role, email: user.email, tv: user.tokenVersion })
    return jsonWithSession({
      token,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
