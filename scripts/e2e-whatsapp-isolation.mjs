#!/usr/bin/env node
// ============================================================
// CRM ALBRA — E2E de AISLAMIENTO WHATSAPP multi-tenant (HTTP real)
//
// Auditoría pre-venta P0 (regresión de aislamiento): a diferencia de los
// tests de integración (handler-level con fetch stubbed), aquí TODO es
// HTTP real: un servidor standalone del CRM con BD propia y un daemon
// mock con auth interna (Bearer INTERNAL_API_SECRET) en otro puerto.
//
//   S1  daemon vinculado a ORG-A  → ORG-B: 403 en TODO (conversations,
//       send, connect, disconnect, logout, qr, status, PUT)
//                                  → ORG-A: 200 normal (dueño)
//   S2  daemon UNLINKED verificado → ORG-A puede /connect; ORG-B no opera
//   S3  daemon CAÍDO               → DENIED para A y B (fail-closed)
//
// Uso:  node scripts/e2e-whatsapp-isolation.mjs
// Reqs: build previo (.next/standalone) — el script levanta su propia app
//       en :3100 con BD efímera y su propio mock de daemon en :3997.
// Exit: 0 PASS · 1 FAIL
// ============================================================

import http from 'node:http'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP_PORT = 3100
const MOCK_PORT = 3997
const BASE = `http://127.0.0.1:${APP_PORT}`
const TS = Date.now()
const results = []

function ok(step, cond, extra = '') {
  results.push({ step, pass: !!cond, extra })
  console.log(`${cond ? '✅' : '❌'} ${step}${extra ? ` — ${extra}` : ''}`)
  if (!cond) process.exitCode = 1
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, text: json ? JSON.stringify(json) : '' }
}

function proxy(token, path, body) {
  if (body !== undefined) return api('POST', '/api/whatsapp/daemon-proxy', { token, body: { path, ...body } })
  return api('GET', `/api/whatsapp/daemon-proxy?path=${encodeURIComponent(path)}`, { token })
}

function proxyPut(token, path, body) {
  return api('PUT', '/api/whatsapp/daemon-proxy', { token, body: { path, ...body } })
}

function decodeOrgId(jwt) {
  const payload = String(jwt).split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64').toString()).orgId
}

// ---------- Mock daemon (con auth interna como el real) ----------
const INTERNAL = 'e2e-wa-internal-secret-0123456789abcdef'
const state = { orgLinked: false, linkedOrgId: null }
let mockServer = null

function startMockDaemon() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x')
      const auth = req.headers.authorization
      const reply = (code, obj) => {
        const body = JSON.stringify(obj)
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(body)
      }
      // Control channel (solo para el E2E, sin auth)
      if (req.method === 'POST' && url.pathname === '/__set') {
        let chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const s = JSON.parse(Buffer.concat(chunks).toString())
          state.orgLinked = !!s.orgLinked
          state.linkedOrgId = s.linkedOrgId ?? null
          reply(200, { ok: true, ...state })
        })
        return
      }
      if (req.method === 'POST' && url.pathname === '/__down') {
        reply(200, { ok: true })
        setTimeout(() => mockServer.close(() => resolve('down')), 50)
        return
      }
      // Endpoints reales: exigen el secreto interno (como el daemon real)
      if (auth !== `Bearer ${INTERNAL}`) return reply(401, { error: 'unauthorized' })
      if (req.method === 'GET' && url.pathname === '/status') {
        return reply(200, {
          status: state.orgLinked ? 'connected' : 'disconnected',
          phone: state.orgLinked ? '+573009990000' : null,
          orgLinked: state.orgLinked,
          linkedOrgId: state.linkedOrgId,
        })
      }
      if (req.method === 'GET' && url.pathname === '/qr') {
        return reply(200, { status: state.orgLinked ? 'connected' : 'waiting_qr', qr: state.orgLinked ? null : 'data:image/png;base64,e2e-qr' })
      }
      if (req.method === 'GET' && url.pathname === '/conversations') {
        return reply(200, { conversations: [{ id: 'conv-1', contactPhone: '+573001110000', organizationId: state.linkedOrgId }] })
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/conversations/')) {
        return reply(200, { success: true })
      }
      if (req.method === 'POST' && ['/connect', '/disconnect', '/send', '/logout'].includes(url.pathname)) {
        return reply(200, { success: true, status: 'connecting' })
      }
      reply(404, { error: 'not found' })
    })
    mockServer.listen(MOCK_PORT, '127.0.0.1', () => resolve(mockServer))
  })
}

async function setScenario(orgLinked, linkedOrgId = null) {
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgLinked, linkedOrgId }),
  })
}

// ---------- App standalone con BD efímera ----------
function startApp(dbFile) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    HOSTNAME: '127.0.0.1',
    DATABASE_URL: `file:${dbFile}`,
    APP_SECRET: `e2e-wa-app-secret-${TS}`,
    APP_ENCRYPTION_KEY: `e2e-wa-encryption-key-${TS}`,
    INTERNAL_API_SECRET: INTERNAL,
    WHATSAPP_DAEMON_URL: `http://127.0.0.1:${MOCK_PORT}`,
    NEXT_TELEMETRY_DISABLED: '1',
    SKIP_DB_PUSH: '1',
  }
  const child = spawn(process.execPath, [join(ROOT, '.next', 'standalone', 'server.js')], {
    env,
    stdio: 'ignore',
  })
  return child
}

async function waitHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) {
        const j = await r.json().catch(() => null)
        if (j?.ok && j?.checks?.db) return true
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function main() {
  const serverJs = join(ROOT, '.next', 'standalone', 'server.js')
  if (!process.argv.includes('--use-running-app')) {
    const fs = await import('node:fs')
    if (!fs.existsSync(serverJs)) {
      console.error('FAIL: falta .next/standalone — ejecuta antes: bun run build (o npm run build)')
      process.exit(1)
    }
  }

  const mock = await startMockDaemon()

  let app = null
  if (!process.argv.includes('--use-running-app')) {
    // BD efímera desde cero (schema con prisma db push)
    const dbFile = join(ROOT, 'db', `e2e-wa-${TS}.db`)
    execSync(`npx prisma db push --skip-generate`, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'pipe',
    })
    app = startApp(dbFile)
    app.unref()
  }

  try {
    const healthy = await waitHealth()
    ok('0. App standalone arranca + health con BD propia', healthy)

    // Dos organizaciones reales (HTTP real, JWT real)
    const regA = await api('POST', '/api/auth/register', { body: { name: 'Owner WA A', email: `wa-a-${TS}@t.albra`, password: 'E2e-Passw0rd!' } })
    const regB = await api('POST', '/api/auth/register', { body: { name: 'Owner WA B', email: `wa-b-${TS}@t.albra`, password: 'E2e-Passw0rd!' } })
    ok('1. Org A y Org B registradas (JWT reales)', regA.status === 200 && !!regA.json?.token && regB.status === 200 && !!regB.json?.token)
    const tokA = regA.json.token
    const tokB = regB.json.token
    const orgA = decodeOrgId(tokA)
    const orgB = decodeOrgId(tokB)

    // ============ S1: daemon vinculado a ORG-A ============
    await setScenario(true, orgA)

    const stA = await proxy(tokA, '/status')
    ok('S1a. Dueño (A) consulta status → 200 con SU org', stA.status === 200 && stA.json?.linkedOrgId === orgA, `org=${orgA?.slice(0, 8)}`)

    const stB = await proxy(tokB, '/status')
    ok('S1b. B consulta status de sesión de A → 403 (sin fuga de teléfono/org)', stB.status === 403 && !stB.text.includes('+573009990000') && !stB.text.includes(orgA))

    const qrB = await proxy(tokB, '/qr')
    ok('S1c. B pide QR de la sesión de A → 403', qrB.status === 403)

    const convB = await proxy(tokB, '/conversations')
    ok('S1d. B lee conversaciones de A → 403', convB.status === 403)

    const sendB = await proxy(tokB, '/send', { to: '+573001110000', text: 'secuestro' })
    ok('S1e. B envía usando sesión de A → 403', sendB.status === 403)

    const connB = await proxy(tokB, '/connect', {})
    ok('S1f. B conecta/roba la sesión de A → 403', connB.status === 403)

    const discB = await proxy(tokB, '/disconnect', {})
    ok('S1g. B desconecta la sesión de A → 403', discB.status === 403)

    const putB = await proxyPut(tokB, '/conversations/conv-1', { isAutoReply: false })
    ok('S1h. B modifica conversación de A (PUT) → 403', putB.status === 403)

    const convA = await proxy(tokA, '/conversations')
    ok('S1i. Dueño (A) lee sus conversaciones → 200', convA.status === 200 && Array.isArray(convA.json?.conversations))

    const sendA = await proxy(tokA, '/send', { to: '+573001110000', text: 'hola desde A' })
    ok('S1j. Dueño (A) envía → 200', sendA.status === 200)

    // ============ S2: daemon sin sesión vinculada (verificado) ============
    await setScenario(false, null)

    const connA2 = await proxy(tokA, '/connect', {})
    ok('S2a. UNLINKED: A puede conectar (vinculación inicial) → 200', connA2.status === 200)

    const sendB2 = await proxy(tokB, '/send', { to: '+573001110000', text: 'hola' })
    ok('S2b. UNLINKED: B intenta enviar → 403 (no hay sesión de B)', sendB2.status === 403)

    const convB2 = await proxy(tokB, '/conversations')
    ok('S2c. UNLINKED: B lee conversaciones → 403', convB2.status === 403)

    // ============ S3: daemon CAÍDO (fail-closed) ============
    await new Promise((r) => mock.close(() => r()))
    await setScenario(true, orgA).catch(() => {})

    const sendA3 = await proxy(tokA, '/send', { to: '+573001110000', text: 'hola' }).catch((e) => ({ status: 0, error: String(e) }))
    ok('S3a. Daemon caído: A intenta enviar → DENIED 403 (fail-closed, nunca continuar)', sendA3.status === 403, sendA3.error || '')

    const stA3 = await proxy(tokA, '/status')
    ok('S3b. Daemon caído: A consulta status → DENIED 403 (sin estado simulado)', stA3.status === 403)

    const convB3 = await proxy(tokB, '/conversations')
    ok('S3c. Daemon caído: B lee conversaciones → DENIED 403', convB3.status === 403)

    const connB3 = await proxy(tokB, '/connect', {}).catch((e) => ({ status: 0, error: String(e) }))
    ok('S3d. Daemon caído: B conecta → DENIED 403', connB3.status === 403, connB3.error || '')
  } finally {
    if (app) { try { app.kill('SIGTERM') } catch {} }
    if (mockServer && mockServer.listening) { try { mockServer.close() } catch {} }
    // Limpieza de la BD efímera
    try {
      const fs = await import('node:fs')
      for (const f of fs.readdirSync(join(ROOT, 'db'))) {
        if (f.startsWith(`e2e-wa-${TS}`)) fs.rmSync(join(ROOT, 'db', f), { force: true })
      }
    } catch {}
  }

  const passed = results.filter((r) => r.pass).length
  console.log(`\nE2E WhatsApp isolation: ${passed}/${results.length} pasos OK → ${passed === results.length ? 'PASS' : 'FAIL'}`)
  if (passed !== results.length) process.exit(1)
}

main().catch((e) => {
  console.error('E2E error:', e)
  process.exit(1)
})
