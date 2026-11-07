import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as forgotPOST } from '@/app/api/auth/forgot-password/route'
import { DELETE as notificationsAllDELETE } from '@/app/api/notifications/all/route'
import { FIX, jsonBody, req, tokenA } from '../helpers'
import { resetAllRateLimits } from '@/lib/rate-limit'
import { hashPassword } from '@/lib/auth'

/**
 * Reparación integral B2 — rate limiting y endurecimiento de auth:
 * - login: 11º intento desde la misma IP → 429 (10/min) con mensaje genérico.
 * - login: el bucket por email consume solo en FALLOS (5/15min) → 6º fallo
 *   del mismo email → 429 aunque la IP no esté agotada.
 * - login: NO distingue usuario inexistente de contraseña incorrecta (401 igual).
 * - forgot-password: siempre 200 con el MISMO cuerpo (anti-enumeración), aunque
 *   el email no exista; 6ª petición mismo IP+email → 429 (5/h persistente, fusión).
 * - notifications/all con rol agent → 403 (exige 'notifications.manage').
 */

const WRONG_PASSWORD = 'no-es-la-contraseña'

describe('B2 — login rate limiting', () => {
  beforeEach(async () => resetAllRateLimits())

  it('31º intento desde la misma IP → 429 con mensaje genérico y Retry-After (límite PERSISTENTE 30/min de la fusión)', async () => {
    // (fusión) la 2ª reparación fijó el límite por IP en 30/min PERSISTENTE en BD
    // (dbRateLimit, efectivo entre instancias) y el por cuenta en 10/min.
    for (let i = 0; i < 30; i++) {
      const res = await loginPOST(req('/api/auth/login', {
        method: 'POST',
        body: { email: `fuerza-bruta-${i}@test.albra`, password: WRONG_PASSWORD },
      }))
      expect(res.status).toBe(401)
    }
    const res31 = await loginPOST(req('/api/auth/login', {
      method: 'POST',
      body: { email: `fuerza-bruta-30@test.albra`, password: WRONG_PASSWORD },
    }))
    expect(res31.status).toBe(429)
    const body = await jsonBody(res31)
    expect(body.error).toBe('Demasiados intentos de inicio de sesión. Inténtalo más tarde.')
    expect(Number(res31.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('11º fallo del MISMO email → 429 aunque la IP tenga cuota restante (10/min por cuenta)', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await loginPOST(req('/api/auth/login', {
        method: 'POST',
        body: { email: FIX.userB.email, password: WRONG_PASSWORD },
      }))
      expect(res.status).toBe(401)
    }
    const res11 = await loginPOST(req('/api/auth/login', {
      method: 'POST',
      body: { email: FIX.userB.email, password: WRONG_PASSWORD },
    }))
    expect(res11.status).toBe(429)
  })

  it('los aciertos NO consumen el bucket por email: 6 logins válidos seguidos → 200', async () => {
    // Usuario real con contraseña verificable para el flujo completo.
    await db.user.upsert({
      where: { email: 'login-valido@test.albra' },
      update: { passwordHash: hashPassword('Clave-Valida-2026'), isActive: true },
      create: {
        email: 'login-valido@test.albra',
        name: 'Login Válido',
        passwordHash: hashPassword('Clave-Valida-2026'),
        role: 'member',
        organizationId: FIX.orgA.id,
      },
    })
    for (let i = 0; i < 6; i++) {
      const res = await loginPOST(req('/api/auth/login', {
        method: 'POST',
        body: { email: 'login-valido@test.albra', password: 'Clave-Valida-2026' },
      }))
      expect(res.status).toBe(200)
    }
  })

  it('anti-enumeración: 401 IDÉNTICO para email inexistente y contraseña errónea', async () => {
    const noUser = await loginPOST(req('/api/auth/login', {
      method: 'POST',
      body: { email: 'no-existe@test.albra', password: WRONG_PASSWORD },
    }))
    const badPass = await loginPOST(req('/api/auth/login', {
      method: 'POST',
      body: { email: FIX.userA.email, password: WRONG_PASSWORD },
    }))
    expect(noUser.status).toBe(401)
    expect(badPass.status).toBe(401)
    const noUserBody = await jsonBody(noUser)
    const badPassBody = await jsonBody(badPass)
    expect(noUserBody.error).toBe(badPassBody.error)
    expect(noUserBody.error).toBe('Credenciales inválidas')
  })
})

describe('B2 — forgot-password anti-enumeración y rate limit', () => {
  beforeEach(async () => resetAllRateLimits())

  it('en PRODUCCIÓN siempre 200 con cuerpo GENÉRICO e idéntico, exista o no el email', async () => {
    // (fusión) en desarrollo la 2ª reparación expone resetToken para pruebas
    // manuales; la garantía anti-enumeración estricta es de PRODUCCIÓN.
    const prevEnv: string | undefined = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
    try {
      const existente = await forgotPOST(req('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: FIX.userA.email },
      }))
      const inexistente = await forgotPOST(req('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: 'nadie-con-este-email@test.albra' },
      }))
      expect(existente.status).toBe(200)
      expect(inexistente.status).toBe(200)
      const a = await jsonBody(existente)
      const b = await jsonBody(inexistente)
      expect(a).toEqual(b) // ni token, ni pistas, ni diferencia de forma
      expect(String(a.message)).toMatch(/si el email está registrado/i)
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevEnv
    }
  })

  it('no revela el token de reset en la respuesta en PRODUCCIÓN', async () => {
    const prevEnv: string | undefined = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production'
    try {
      const res = await forgotPOST(req('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: FIX.userA.email },
      }))
      const body = await jsonBody(res)
      expect(body.resetToken).toBeUndefined()
      expect(JSON.stringify(body)).not.toMatch(/resetToken/)
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevEnv
    }
  })

  it('6ª petición del mismo IP+email → 429 (5/h PERSISTENTE en la fusión)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await forgotPOST(req('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: 'rate-forgot@test.albra' },
      }))
      expect(res.status).toBe(200)
    }
    const res6 = await forgotPOST(req('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'rate-forgot@test.albra' },
    }))
    expect(res6.status).toBe(429)
  })
})

describe('B2 — notifications/all exige permiso de admin', () => {
  let agentToken = ''

  beforeAll(async () => {
    const agent = await db.user.upsert({
      where: { email: 'agent-notif@test.albra' },
      update: { role: 'agent', organizationId: FIX.orgA.id },
      create: {
        email: 'agent-notif@test.albra',
        name: 'Agent Notificaciones',
        passwordHash: 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128),
        role: 'agent',
        organizationId: FIX.orgA.id,
      },
    })
    const { signToken } = await import('@/lib/auth')
    agentToken = signToken({ userId: agent.id, orgId: FIX.orgA.id, role: 'agent', email: agent.email })
  })

  it('rol agent → 403 (antes borraba todas con cualquier rol)', async () => {
    const res = await notificationsAllDELETE(req('/api/notifications/all', { method: 'DELETE', token: agentToken }))
    expect(res.status).toBe(403)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/notifications\.manage|permiso/i)
  })

  it('owner de la organización → 200 (borra solo las de SU org)', async () => {
    await db.notification.create({
      data: { organizationId: FIX.orgA.id, userId: FIX.userA.id, title: 'Notificación de prueba', type: 'system' },
    })
    const res = await notificationsAllDELETE(req('/api/notifications/all', { method: 'DELETE', token: tokenA() }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.success).toBe(true)
  })

  it('sin sesión → 401', async () => {
    const res = await notificationsAllDELETE(req('/api/notifications/all', { method: 'DELETE' }))
    expect(res.status).toBe(401)
  })

  it('sanity: el owner de OTRA org no toca notificaciones ajenas (scope por orgId)', async () => {
    await db.notification.create({
      data: { organizationId: FIX.orgB.id, userId: FIX.userB.id, title: 'De org B', type: 'system' },
    })
    const res = await notificationsAllDELETE(req('/api/notifications/all', { method: 'DELETE', token: tokenA() }))
    expect(res.status).toBe(200)
    const left = await db.notification.count({ where: { organizationId: FIX.orgB.id, title: 'De org B' } })
    expect(left).toBe(1) // intacta
    await db.notification.deleteMany({ where: { organizationId: FIX.orgB.id, title: 'De org B' } })
  })
})
