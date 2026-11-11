import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { GET as meGET } from '@/app/api/auth/me/route'
import { POST as verifyPOST } from '@/app/api/auth/2fa/verify/route'
import { POST as setupPOST } from '@/app/api/auth/2fa/setup/route'
import { POST as enablePOST } from '@/app/api/auth/2fa/enable/route'
import { POST as disablePOST } from '@/app/api/auth/2fa/disable/route'
import { GET as statusGET } from '@/app/api/auth/2fa/status/route'
import { FIX, jsonBody, req, tokenFor } from '../helpers'
import { resetAllRateLimits } from '@/lib/rate-limit'
import { hashPassword, verifyToken, signMfaTicket } from '@/lib/auth'
import {
  totpCode,
  totpCounterAt,
  verifyTotp,
  base32Encode,
  base32Decode,
  generateRecoveryCodes,
  consumeRecoveryCode,
  hashRecoveryCode,
} from '@/lib/two-factor'

/**
 * OLEADA 2 — Autenticación de dos factores (TOTP RFC 6238):
 *
 * LIB (vectores RFC 6238 verificados contra la referencia oficial):
 *  - totpCode reproduce el vector del RFC (secreto "12345678901234567890").
 *  - base32 roundtrip; ventana ±1; anti-replay por contador.
 *  - códigos de recuperación: 8, formato XXXX-XXXX, un solo uso real.
 *
 * FLUJO END-TO-END:
 *  - setup → secreto cifrado en BD (v1:...), qr + otpauth; en claro una vez.
 *  - enable con código válido → activo + 8 códigos de recuperación (hashes en BD).
 *  - login → mfaRequired + mfaToken; SIN token de sesión ni cookie.
 *  - el ticket MFA NO sirve como sesión (me → 401).
 *  - verify con TOTP → sesión real; replay del MISMO código → 401.
 *  - verify con recovery → sesión; el mismo recovery NO vuelve a servir.
 *  - disable exige contraseña + código; tras desactivar el login es normal.
 *  - aislamiento: ticket expirado o de otra org → 401 fail-closed.
 */

const EMAIL = '2fa-user@test.albra'
const PASSWORD = 'Clave-2FA-2026'

let userId = ''
let authToken = '' // sesión del usuario de pruebas (para setup/enable/disable/status)

async function loginStep(): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await loginPOST(req('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } }))
  const body = (await jsonBody(res)) as Record<string, unknown>
  return { res, body }
}

describe('2FA — lib TOTP (vectores RFC 6238 y semántica)', () => {
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // base32 de "12345678901234567890"

  it('totpCode reproduce el vector RFC 6238 (SHA-1, 6 dígitos)', () => {
    expect(totpCode(RFC_SECRET, 1)).toBe('287082') // T=59 s (RFC: 8 dígitos → 94287082)
    expect(totpCode(RFC_SECRET, 100000)).toBe('225563')
    expect(totpCode(RFC_SECRET, 100001)).toBe('042092')
  })

  it('base32 roundtrip y validación de alfabeto', () => {
    expect(base32Encode(base32Decode(RFC_SECRET))).toBe(RFC_SECRET)
    expect(base32Encode(base32Decode('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP')
  })

  it('verifyTotp acepta ventana ±1 y rechaza códigos fuera de ventana', () => {
    const t = new Date(1_700_000_000_000) // instante fijo
    const counter = totpCounterAt(t)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter), { now: t }).ok).toBe(true)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter - 1), { now: t }).ok).toBe(true)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter + 1), { now: t }).ok).toBe(true)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter + 2), { now: t }).ok).toBe(false)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter - 2), { now: t }).ok).toBe(false)
  })

  it('verifyTotp anti-replay: notBeforeCounter obliga contador estrictamente mayor', () => {
    const t = new Date(1_700_000_000_000)
    const counter = totpCounterAt(t)
    const r = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, counter), { now: t, notBeforeCounter: counter })
    expect(r.ok).toBe(false)
    expect(r.replayed).toBe(true)
  })

  it('códigos de recuperación: 8, formato, un solo uso, insensibles a caja/separadores', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(8)
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const store = JSON.stringify(codes.map(hashRecoveryCode))
    const first = consumeRecoveryCode(store, codes[0].toLowerCase()) // minúsculas + guion
    expect(first).not.toBeNull()
    expect(first!.remaining).toHaveLength(7)
    expect(consumeRecoveryCode(JSON.stringify(first!.remaining), codes[0])).toBeNull() // ya usado
    expect(consumeRecoveryCode(JSON.stringify(first!.remaining), 'ZZZZ-9999')).toBeNull() // ajeno
    expect(consumeRecoveryCode('{no-json', codes[1])).toBeNull() // almacenamiento corrupto
  })
})

describe('2FA — flujo end-to-end por API', () => {
  beforeAll(async () => {
    const user = await db.user.upsert({
      where: { email: EMAIL },
      update: {
        passwordHash: hashPassword(PASSWORD),
        isActive: true,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecovery: null,
        twoFactorLastCounter: null,
      },
      create: {
        email: EMAIL,
        name: 'Usuario 2FA',
        passwordHash: hashPassword(PASSWORD),
        role: 'member',
        organizationId: FIX.orgA.id,
      },
    })
    userId = user.id
    authToken = tokenFor({ id: user.id, email: user.email, role: user.role, organizationId: user.organizationId })
  })

  beforeEach(async () => resetAllRateLimits())

  it('status inicial: enabled=false, pendingSetup=false', async () => {
    const res = await statusGET(req('/api/auth/2fa/status', { token: authToken }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.enabled).toBe(false)
    expect(body.pendingSetup).toBe(false)
  })

  let secret = ''
  let recoveryCodes: string[] = []

  it('setup genera secreto, URI otpauth y QR; en BD queda CIFRADO (v1:...)', async () => {
    const res = await setupPOST(req('/api/auth/2fa/setup', { method: 'POST', token: authToken, body: {} }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(typeof (body as Record<string, string>).secret).toBe('string')
    expect((body as Record<string, string>).otpauthUri).toMatch(/^otpauth:\/\/totp\/ALBRA%3A[a-z0-9._@%-]+\?secret=[A-Z2-7]+&issuer=ALBRA&algorithm=SHA1&digits=6&period=30$/i)
    expect((body as Record<string, string>).qrDataUrl).toMatch(/^data:image\/png;base64,/)
    secret = (body as Record<string, string>).secret

    const inDb = await db.user.findUnique({ where: { id: userId }, select: { twoFactorSecret: true, twoFactorEnabled: true } })
    expect(inDb!.twoFactorSecret).toMatch(/^v1:/) // AES-256-GCM, jamás en claro
    expect(inDb!.twoFactorSecret).not.toContain(secret)
    expect(inDb!.twoFactorEnabled).toBe(false) // aún no confirmado
  })

  it('enable con código INVÁLIDO → 401 y sigue inactivo', async () => {
    const res = await enablePOST(req('/api/auth/2fa/enable', { method: 'POST', token: authToken, body: { code: '000000' } }))
    expect(res.status).toBe(401)
    const inDb = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } })
    expect(inDb!.twoFactorEnabled).toBe(false)
  })

  it('enable con código TOTP VÁLIDO → activo + 8 códigos de recuperación (solo hashes en BD)', async () => {
    const code = totpCode(secret, totpCounterAt(new Date()))
    const res = await enablePOST(req('/api/auth/2fa/enable', { method: 'POST', token: authToken, body: { code } }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    recoveryCodes = (body as { recoveryCodes: string[] }).recoveryCodes
    expect(recoveryCodes).toHaveLength(8)

    const inDb = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true, twoFactorRecovery: true } })
    expect(inDb!.twoFactorEnabled).toBe(true)
    const hashes = JSON.parse(inDb!.twoFactorRecovery || '[]') as string[]
    expect(hashes).toHaveLength(8)
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/)
    for (const c of recoveryCodes) expect(hashes).toContain(hashRecoveryCode(c)) // hash del normalizado
    // NUNCA el código en claro en BD:
    const raw = JSON.stringify(inDb)
    for (const c of recoveryCodes) expect(raw).not.toContain(c)
  })

  it('setup con 2FA ya activo → 409', async () => {
    const res = await setupPOST(req('/api/auth/2fa/setup', { method: 'POST', token: authToken, body: {} }))
    expect(res.status).toBe(409)
  })

  it('login con 2FA activo → mfaRequired + mfaToken, SIN sesión ni cookie', async () => {
    const { res, body } = await loginStep()
    expect(res.status).toBe(200)
    expect(body.mfaRequired).toBe(true)
    expect(typeof body.mfaToken).toBe('string')
    expect(body.token).toBeUndefined() // NINGÚN token de sesión
    expect(res.headers.get('set-cookie')).toBeNull() // NINGUNA cookie de sesión
    const payload = verifyToken(body.mfaToken as string)
    expect(payload?.mfa).toBe(true)
    expect(payload?.userId).toBe(userId)
  })

  it('el ticket MFA NO autentica operaciones de negocio (me → 401)', async () => {
    const { body } = await loginStep()
    const res = await meGET(req('/api/auth/me', { token: body.mfaToken as string }))
    expect(res.status).toBe(401)
  })

  it('verify con TOTP válido → sesión real funcional (me 200)', async () => {
    const { body } = await loginStep()
    // Contador NO consumido (el enable consumió el actual): determinista aunque
    // la ventana de 30 s rote a mitad de suite.
    const user = await db.user.findUnique({ where: { id: userId }, select: { twoFactorLastCounter: true } })
    const last = user?.twoFactorLastCounter ?? -1
    const now = totpCounterAt(new Date())
    const counter = [now + 1, now, now - 1].find((c) => c > last) ?? now + 1
    const code = totpCode(secret, counter)
    const res = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: body.mfaToken, code } }))
    expect(res.status).toBe(200)
    const session = (await jsonBody(res)) as { token?: string; user?: { id: string } }
    expect(session.token).toBeTruthy()
    expect(session.user?.id).toBe(userId)

    const me = await meGET(req('/api/auth/me', { token: session.token! }))
    expect(me.status).toBe(200)
  })

  it('verify con código TOTP incorrecto → 401 genérico', async () => {
    const { body } = await loginStep()
    // código del contador lejano: ni actual ni ±1 → siempre inválido
    const bad = totpCode(secret, totpCounterAt(new Date()) + 10)
    const res = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: body.mfaToken, code: bad } }))
    expect(res.status).toBe(401)
    const err = await jsonBody(res)
    expect((err as { error: string }).error).toContain('Código inválido')
  })

  it('código de recuperación: sirve UNA vez; el mismo NO vuelve a servir', async () => {
    const { body } = await loginStep()
    const res = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: body.mfaToken, code: recoveryCodes[0] } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeTruthy() // sesión con cookie httpOnly

    const { body: body2 } = await loginStep()
    const replay = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: body2.mfaToken, code: recoveryCodes[0] } }))
    expect(replay.status).toBe(401)

    const status = await statusGET(req('/api/auth/2fa/status', { token: authToken }))
    const s = await jsonBody(status)
    expect(s.recoveryCodesLeft).toBe(7)
  })

  it('ticket MFA expirado → 401 (sin sesión)', async () => {
    const expired = signMfaTicket({ userId, orgId: FIX.orgA.id, role: 'member', email: EMAIL }, -10) // -10 min
    const res = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: expired, code: '123456' } }))
    expect(res.status).toBe(401)
  })

  it('aislamiento multi-tenant: ticket cuya org ya no coincide con el usuario → 401 fail-closed', async () => {
    const { body } = await loginStep()
    // Simulación: el usuario "se movió" de organización después de emitirse el ticket.
    await db.user.update({ where: { id: userId }, data: { organizationId: FIX.orgB.id } })
    const res = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: body.mfaToken, code: totpCode(secret, totpCounterAt(new Date()) + 1) } }))
    expect(res.status).toBe(401)
    await db.user.update({ where: { id: userId }, data: { organizationId: FIX.orgA.id } })
  })

  it('disable exige contraseña + código; con contraseña MALA → 401', async () => {
    const res = await disablePOST(req('/api/auth/2fa/disable', { method: 'POST', token: authToken, body: { password: 'incorrecta', code: recoveryCodes[1] } }))
    expect(res.status).toBe(401)
    const inDb = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } })
    expect(inDb!.twoFactorEnabled).toBe(true)
  })

  it('disable con contraseña + código de recuperación → inactivo; login vuelve a ser normal', async () => {
    const res = await disablePOST(req('/api/auth/2fa/disable', { method: 'POST', token: authToken, body: { password: PASSWORD, code: recoveryCodes[1] } }))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.enabled).toBe(false)

    const inDb = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true, twoFactorSecret: true, twoFactorRecovery: true, twoFactorLastCounter: true } })
    expect(inDb!.twoFactorEnabled).toBe(false)
    expect(inDb!.twoFactorSecret).toBeNull()
    expect(inDb!.twoFactorRecovery).toBeNull()
    expect(inDb!.twoFactorLastCounter).toBeNull()

    const { res: loginRes, body: loginBody } = await loginStep()
    expect(loginRes.status).toBe(200)
    expect(loginBody.mfaRequired).toBeUndefined()
    expect(loginBody.token).toBeTruthy()
  })

  it('re-enrolamiento completo con anti-replay: setup → enable → login → verify OK → replay del MISMO código → 401', async () => {
    // (determinista) enable fresco consume el contador actual; el verify usa el
    // siguiente (now+1, tolerado por ventana ±1) y el replay del MISMO código
    // (nuevo ticket) queda bloqueado por twoFactorLastCounter.
    const s = await setupPOST(req('/api/auth/2fa/setup', { method: 'POST', token: authToken, body: {} }))
    const secret3 = ((await jsonBody(s)) as { secret: string }).secret
    const code = totpCode(secret3, totpCounterAt(new Date()))
    const e = await enablePOST(req('/api/auth/2fa/enable', { method: 'POST', token: authToken, body: { code } }))
    expect(e.status).toBe(200)

    const { body } = await loginStep()
    expect(body.mfaRequired).toBe(true)
    const codeNext = totpCode(secret3, totpCounterAt(new Date()) + 1)
    const v = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: body.mfaToken, code: codeNext } }))
    expect(v.status).toBe(200)

    const { body: body2 } = await loginStep()
    const replay = await verifyPOST(req('/api/auth/2fa/verify', { method: 'POST', body: { mfaToken: body2.mfaToken, code: codeNext } }))
    expect(replay.status).toBe(401)
  })
})
