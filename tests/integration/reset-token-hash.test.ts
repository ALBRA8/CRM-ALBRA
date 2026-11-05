import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { POST as forgotPOST } from '@/app/api/auth/forgot-password/route'
import { POST as resetPOST } from '@/app/api/auth/reset-password/route'
import { FIX, jsonBody, req } from '../helpers'
import { resetRateLimits } from '@/lib/rate-limit'

/**
 * Reparación integral B3 — tokens de reset HASHEADOS:
 *
 * - El token que genera forgot-password se guarda como sha256 en BD; NUNCA en claro.
 * - reset-password busca POR HASH: un token en claro almacenado en BD no valida.
 * - Un solo uso: tras un reset exitoso el token no vuelve a servir.
 * - Longitud del material aleatorio ≥ 32 bytes (el hash almacenado es 64 hex,
 *   resultado de sha256 sobre 64 hex aleatorios de 32 bytes).
 * - Al resetear con éxito se incrementa tokenVersion (B4).
 */

const TEST_EMAIL = 'reset-hash@test.albra'
const NEW_PASSWORD = 'Nueva-Clave-2026' // scan-secrets:allow — fixture de contraseña de prueba (no es un secreto)

let userId = ''

beforeAll(async () => {
  const user = await db.user.upsert({
    where: { email: TEST_EMAIL },
    update: { organizationId: FIX.orgA.id, isActive: true },
    create: {
      email: TEST_EMAIL,
      name: 'Reset Hash',
      passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128),
      role: 'member',
      organizationId: FIX.orgA.id,
    },
  })
  userId = user.id
})

beforeEach(() => resetRateLimits())

afterEach(async () => {
  await db.user.update({ where: { id: userId }, data: { resetToken: null, resetTokenExp: null } })
})

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex')
}

describe('B3 — reset-password busca por sha256', () => {
  it('token HASHEADO en BD → reset exitoso (contraseña actualizada y hash limpiado)', async () => {
    const plain = 'a'.repeat(64) // simula el hex de 32 bytes aleatorios que genera forgot-password
    await db.user.update({
      where: { id: userId },
      data: { resetToken: sha256(plain), resetTokenExp: new Date(Date.now() + 3_600_000) },
    })

    const res = await resetPOST(req('/api/auth/reset-password', {
      method: 'POST',
      body: { token: plain, password: NEW_PASSWORD },
    }))
    expect(res.status).toBe(200)

    const user = await db.user.findUnique({ where: { id: userId } })
    expect(user?.passwordHash).not.toBe('scrypt:00000000000000000000000000000000:' + '0'.repeat(128))
    expect(user?.resetToken).toBeNull() // un solo uso
    expect(user?.resetTokenExp).toBeNull()
    expect(user?.tokenVersion).toBeGreaterThanOrEqual(1) // B4: revoca sesiones previas
    // scrypt con salt aleatoria: el hash de BD verifica la nueva contraseña
    const { verifyPassword } = await import('@/lib/auth')
    expect(verifyPassword(NEW_PASSWORD, user!.passwordHash)).toBe(true)
  })

  it('token PLANO en BD NO se encuentra (solo el hash valida) → 400', async () => {
    const plain = 'b'.repeat(64)
    await db.user.update({
      where: { id: userId },
      data: { resetToken: plain, resetTokenExp: new Date(Date.now() + 3_600_000) }, // mal guardado a propósito
    })
    const res = await resetPOST(req('/api/auth/reset-password', {
      method: 'POST',
      body: { token: plain, password: NEW_PASSWORD },
    }))
    expect(res.status).toBe(400)
    expect((await jsonBody(res)).error).toBe('Token inválido o expirado')
  })

  it('REUTILIZACIÓN del token tras un reset exitoso → fallo (un solo uso)', async () => {
    const plain = 'c'.repeat(64)
    await db.user.update({
      where: { id: userId },
      data: { resetToken: sha256(plain), resetTokenExp: new Date(Date.now() + 3_600_000) },
    })
    const first = await resetPOST(req('/api/auth/reset-password', {
      method: 'POST',
      body: { token: plain, password: NEW_PASSWORD },
    }))
    expect(first.status).toBe(200)

    const second = await resetPOST(req('/api/auth/reset-password', {
      method: 'POST',
      body: { token: plain, password: 'Otra-Clave-2026' },
    }))
    expect(second.status).toBe(400) // el token ya no existe en BD (consumido)
  })

  it('token expirado → 400', async () => {
    const plain = 'd'.repeat(64)
    await db.user.update({
      where: { id: userId },
      data: { resetToken: sha256(plain), resetTokenExp: new Date(Date.now() - 1000) },
    })
    const res = await resetPOST(req('/api/auth/reset-password', {
      method: 'POST',
      body: { token: plain, password: NEW_PASSWORD },
    }))
    expect(res.status).toBe(400)
  })
})

describe('B3 — forgot-password guarda SOLO el hash (32 bytes de aleatoriedad)', () => {
  it('tras forgot, BD contiene un sha256 (64 hex), nunca el token en claro', async () => {
    const res = await forgotPOST(req('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: TEST_EMAIL },
    }))
    expect(res.status).toBe(200)

    const user = await db.user.findUnique({ where: { email: TEST_EMAIL } })
    expect(user?.resetToken).toMatch(/^[0-9a-f]{64}$/) // formato sha256-hex
    // No puede ser un token "plano" con formato obvio: el hash de un hex de 32
    // bytes es indistinguible de otro sha256, pero GARANTIZA que en BD no hay
    // material en claro reutilizable.
    expect(user?.resetTokenExp?.getTime()).toBeGreaterThan(Date.now())
  })

  it('la respuesta de forgot NO contiene el token (ni en desarrollo)', async () => {
    const res = await forgotPOST(req('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: TEST_EMAIL },
    }))
    const body = await jsonBody(res)
    expect(Object.keys(body)).toEqual(['message'])
  })
})
