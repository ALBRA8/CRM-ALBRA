import { describe, expect, it } from 'vitest'
import { POST as importCSV } from '@/app/api/import/csv/route'
import { GET as googleAuthGET } from '@/app/api/google/auth/route'
import { POST as sheetsReadPOST } from '@/app/api/google/sheets/read/route'
import { GET as daemonGET, POST as daemonPOST, PUT as daemonPUT } from '@/app/api/whatsapp/daemon-proxy/route'
import { can } from '@/lib/rbac'
import { FIX, jsonBody, req, tokenA, tokenB } from '../helpers'

/**
 * RBAC server-side — huecos cerrados (Task 25).
 *
 * El catálogo RBAC existía (rbac.ts + requirePermission), pero varias rutas
 * sensibles solo exigían sesión (requireAuth): un member podía importar CSV en
 * masa, iniciar el OAuth de Google o CONECTAR/DESCONECTAR la sesión de
 * WhatsApp de la organización. Estos tests fijan el contrato nuevo:
 *
 *  - member (userB, rol comercial)  → 403 en operaciones de admin/integración,
 *    pero SIGUE operando en lo suyo (leer estado, enviar WhatsApp).
 *  - owner (userA)                  → pasa el gate (respuesta del negocio,
 *    nunca 403 de permisos).
 *  - sin token                      → 401 en todas.
 */

describe('RBAC server-side — gates nuevos', () => {
  it('member NO puede importar CSV en masa (data.import)', async () => {
    const res = await importCSV(req('/api/import/csv', { method: 'POST', token: tokenB() }))
    expect(res.status).toBe(403)
    const body = await jsonBody(res)
    expect(String(body.error)).toContain('data.import')
  })

  it('member NO puede iniciar el OAuth de Google de la org (integrations.*)', async () => {
    const res = await googleAuthGET(req('/api/google/auth', { token: tokenB() }))
    expect(res.status).toBe(403)
  })

  it('member NO puede leer Google Sheets con los tokens de la org (integrations.*)', async () => {
    const res = await sheetsReadPOST(
      req('/api/google/sheets/read', { method: 'POST', token: tokenB(), body: { spreadsheetId: 'x' } })
    )
    expect(res.status).toBe(403)
  })

  it('member NO puede conectar/desconectar/logout la sesión de WhatsApp (integrations.*)', async () => {
    for (const path of ['/connect', '/disconnect', '/logout']) {
      const res = await daemonPOST(
        req('/api/whatsapp/daemon-proxy', { method: 'POST', token: tokenB(), body: { path } })
      )
      expect(res.status, `POST ${path}`).toBe(403)
    }
  })

  it('member SÍ puede actualizar conversaciones (whatsapp.write incluye el PUT)', async () => {
    const res = await daemonPUT(
      req('/api/whatsapp/daemon-proxy', {
        method: 'PUT',
        token: tokenB(),
        body: { path: '/conversations/573001112222', unreadCount: 0 },
      })
    )
    // Gate pasado: el proxy responde (daemon caído → 200 de fallback)
    expect(res.status).not.toBe(403)
  })

  it('member SÍ sigue operando WhatsApp: lee estado y envía mensajes', async () => {
    // GET /status: whatsapp.read del rol comercial (daemon caído → fallback 200)
    const status = await daemonGET(req('/api/whatsapp/daemon-proxy?path=/status', { token: tokenB() }))
    expect(status.status).toBe(200)

    // POST /send: whatsapp.write — pasa el gate (el daemon responde su propio
    // negocio: 400 por body incompleto/sesión no conectada, nunca 403 nuestro)
    const send = await daemonPOST(
      req('/api/whatsapp/daemon-proxy', { method: 'POST', token: tokenB(), body: { path: '/send' } })
    )
    expect(send.status).not.toBe(403)
  })

  it('owner pasa los gates nuevos (respuesta de negocio, nunca 403)', async () => {
    // import/csv sin multipart → 400 del parser, ya PASÓ el gate
    const csv = await importCSV(req('/api/import/csv', { method: 'POST', token: tokenA() }))
    expect(csv.status).toBe(400)

    // google/auth sin OAuth configurado en org-a → 400 descriptivo, gate pasado
    const gauth = await googleAuthGET(req('/api/google/auth', { token: tokenA() }))
    expect(gauth.status).toBe(400)

    // sheets/read sin spreadsheetId → 400 de validación, gate pasado
    const sheets = await sheetsReadPOST(
      req('/api/google/sheets/read', { method: 'POST', token: tokenA(), body: {} })
    )
    expect(sheets.status).toBe(400)
  })

  it('sin token → 401 (antes de evaluar permisos)', async () => {
    expect((await daemonGET(req('/api/whatsapp/daemon-proxy?path=/status'))).status).toBe(401)
    expect((await importCSV(req('/api/import/csv', { method: 'POST' }))).status).toBe(401)
  })

  it('catálogo RBAC: data.import es admin-only y whatsapp.write es del rol comercial', () => {
    expect(can(FIX.userA.role, 'data.import')).toBe(true)
    expect(can('agent', 'data.import')).toBe(false)
    expect(can('agent', 'whatsapp.write')).toBe(true)
    expect(can('agent', 'integrations.*')).toBe(false)
  })
})
