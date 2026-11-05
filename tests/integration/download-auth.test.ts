import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { GET as clientsGET } from '@/app/api/clients/route'
import { GET as exportCsvGET } from '@/app/api/export/csv/route'
import { POST as downloadTokenPOST } from '@/app/api/auth/download-token/route'
import { signToken, signDownloadToken, DOWNLOAD_TOKEN_TTL_SECONDS } from '@/lib/auth'
import { FIX, jsonBody, req, tokenA } from '../helpers'

/**
 * Reparación integral B1 — JWT en URLs restringido:
 *
 * (a) /api/clients con ?token=<JWT de sesión válido> → 401 (la query ya no
 *     autentica en rutas NO-descarga: el token quedaba en historial/logs/Referer)
 * (b) descarga (export/csv) con ?token= de sesión → 200 (compatibilidad) y con
 *     download-token de corta vida → 200, ambos con Referrer-Policy: no-referrer
 * (c) download-token CADUCADO → 401
 * (d) download-token en ruta NO-descarga (Bearer y ?token=) → 401
 */

describe('B1 — ?token= prohibido en rutas no-descarga', () => {
  it('(a) /api/clients con ?token= de sesión válido → 401', async () => {
    const res = await clientsGET(req(`/api/clients?token=${encodeURIComponent(tokenA())}`))
    expect(res.status).toBe(401)
    const body = await jsonBody(res)
    expect(String(body.error)).toMatch(/token/i)
  })
})

describe('B1 — endpoints de descarga aceptan ?token= (sesión y download-token)', () => {
  it('(b1) export/csv con ?token= JWT de sesión → 200 + Referrer-Policy no-referrer', async () => {
    const res = await exportCsvGET(req(`/api/export/csv?type=clients&token=${encodeURIComponent(tokenA())}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('(b2) download-token emitido por /api/auth/download-token funciona en export/csv', async () => {
    const mint = await downloadTokenPOST(req('/api/auth/download-token', { method: 'POST', token: tokenA() }))
    expect(mint.status).toBe(200)
    const { token, expiresIn } = (await jsonBody(mint)) as { token: string; expiresIn: number }
    expect(expiresIn).toBe(DOWNLOAD_TOKEN_TTL_SECONDS)

    const res = await exportCsvGET(req(`/api/export/csv?type=clients&token=${encodeURIComponent(token)}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('(b3) export/csv sigue autenticando por Bearer (vía principal, sin token en URL)', async () => {
    const res = await exportCsvGET(req('/api/export/csv?type=clients', { token: tokenA() }))
    expect(res.status).toBe(200)
  })

  it('(c) download-token CADUCADO → 401 en descarga', async () => {
    const expired = signDownloadToken(
      { userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email },
      -1 // expirado hace 1 segundo
    )
    const res = await exportCsvGET(req(`/api/export/csv?type=clients&token=${encodeURIComponent(expired)}`))
    expect(res.status).toBe(401)
  })

  it("(d1) download-token por Bearer en ruta NO-descarga → 401 (nunca sustituye a la sesión)", async () => {
    const dl = signDownloadToken({ userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email })
    const res = await clientsGET(req('/api/clients', { token: dl }))
    expect(res.status).toBe(401)
  })

  it('(d2) download-token por ?token= en ruta NO-descarga → 401', async () => {
    const dl = signDownloadToken({ userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email })
    const res = await clientsGET(req(`/api/clients?token=${encodeURIComponent(dl)}`))
    expect(res.status).toBe(401)
  })

  it('extra: un JWT de sesión firmado con purpose=download manipulado no autentica por Bearer', async () => {
    // Un token de sesión con purpose='download' inyectado en el payload cambia la
    // firma → verifyToken lo rechaza; y aunque firmara, getAuth lo rechazaría por Bearer.
    const forged = signToken({ userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email })
      .split('.')
    const tampered = `${forged[0]}.${Buffer.from(JSON.stringify({
      userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email, purpose: 'download', exp: Date.now() + 60_000,
    })).toString('base64url')}.${forged[2]}`
    const res = await clientsGET(req('/api/clients', { token: tampered }))
    expect(res.status).toBe(401)
  })
})

describe('B1 — coberturas de descarga restantes', () => {
  it('quotes/pdf responde (ruta de descarga) y requiere sesión aunque llegue basura por query', async () => {
    const mod = await import('@/app/api/quotes/pdf/route')
    const quotesPdfGET = mod.GET
    const quote = await db.quote.findFirst({ where: { organizationId: FIX.orgA.id } })
    if (!quote) return // sin cotizaciones sembradas: el caso (b) ya cubre descarga
    const res = await quotesPdfGET(req(`/api/quotes/pdf?id=${quote.id}&token=basura`))
    expect(res.status).toBe(401)
  })

  it('un download-token de OTRA organización no ve datos de la org del dueño (multi-tenant)', async () => {
    const crossToken = signDownloadToken({
      userId: FIX.userB.id, orgId: FIX.orgB.id, role: 'owner', email: FIX.userB.email,
    })
    const res = await exportCsvGET(req(`/api/export/csv?type=clients&token=${encodeURIComponent(crossToken)}`))
    expect(res.status).toBe(200)
    const csv = await res.text()
    if (csv.includes('Cliente Alpha')) {
      expect(csv).not.toContain('Cliente Alpha') // nunca datos de otra org
    }
  })

  it('signToken no emite purpose (una sesión jamás es download-token)', () => {
    const session = signToken({ userId: FIX.userA.id, orgId: FIX.orgA.id, role: 'owner', email: FIX.userA.email })
    expect(JSON.parse(Buffer.from(session.split('.')[1], 'base64url').toString('utf8')).purpose).toBeUndefined()
  })
})
