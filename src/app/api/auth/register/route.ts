import type { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword, signToken, slugify, HttpError } from '@/lib/auth'
import { handle, jsonWithSession, readBody, requireFields, str } from '../../_lib/shared'
import { createStandardPipeline, createOrgSettings } from '../../_lib/demo-seed'
import { dbRateLimit, clientIp } from '@/lib/rate-limit'
import { json } from '../../_lib/shared'

/** (A2-16) Respuesta uniforme 429 con Retry-After. */
function jsonRateLimited(retryAfter: number) {
  return json(
    { error: 'Demasiadas solicitudes. Intenta más tarde.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

/** POST /api/auth/register — crea Organization + User owner + semillas básicas. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    // (A2-16, auditoría 2026-11-11) Registro abierto: rate limit DURABLE por IP
    // (compartido entre instancias, sobrevive reinicios) — 5 cuentas/min/IP.
    const rl = await dbRateLimit(`register:${clientIp(req)}`, 5, 60_000)
    if (!rl.ok) {
      return jsonRateLimited(rl.retryAfter)
    }
    const body = await readBody(req)
    requireFields(body, ['name', 'email', 'password'])

    const name = str(body.name) as string
    const email = (str(body.email) as string).toLowerCase()
    const password = str(body.password) as string
    const company = str(body.company)
    const phone = str(body.phone)

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email inválido')
    // (A2-17) Mínimo 8 caracteres (NIST SP 800-63B: longitud sobre complejidad).
    if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres')

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

    // (A2-18, auditoría 2026-11-11) Org + usuario owner en UNA transacción:
    // jamás una organización huérfana sin owner (ni un owner sin organización)
    // por un fallo a mitad de camino.
    const { org: orgTx, user } = await db.$transaction(async (tx) => {
      const createdOrg = await tx.organization.create({ data: { name: orgName, slug } })
      const createdUser = await tx.user.create({
        data: {
          email,
          name,
          passwordHash: hashPassword(password),
          company,
          phone,
          role: 'owner',
          organizationId: createdOrg.id,
        },
      })
      return { org: createdOrg, user: createdUser }
    })
    const org = orgTx

    await createStandardPipeline(org.id)
    await createOrgSettings(org.id)

    const token = signToken({ userId: user.id, orgId: org.id, role: user.role, email: user.email, tv: user.tokenVersion })
    return jsonWithSession({
      token,
      user: { id: user.id, name: user.name, email: user.email, company: user.company, phone: user.phone, role: user.role, avatar: user.avatar },
    }, token)
  })
}
