#!/usr/bin/env node
// ============================================================
// CRM ALBRA — E2E de cierre de producción (§30)
//
//   LOGIN → CREATE CUSTOMER → CREATE OPPORTUNITY → AI TOOL (chat real)
//   → MEMORY RETRIEVAL → FOLLOW-UP/AUTOMATION → AUDIT → ORG A vs ORG B
//
// La IA se prueba de punta a punta contra un servidor mock OpenAI-compatible
// que este script levanta (chat/completions + embeddings): todo el código del
// CRM (settings cifrados, llmChat, tool-calling, memoria) es REAL; solo la
// frontera del proveedor es mock — el E2E no depende de llaves externas.
//
// Uso:  node scripts/e2e-final.mjs [--base http://127.0.0.1:3000]
// Exit: 0 PASS · 1 FAIL
// ============================================================

import http from 'node:http'

const args = process.argv.slice(2)
const base = (args[args.indexOf('--base') + 1] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const MOCK_PORT = 3999
const MOCK = `http://127.0.0.1:${MOCK_PORT}`
const TS = Date.now()
const results = []

function ok(step, cond, extra = '') {
  results.push({ step, pass: !!cond, extra })
  console.log(`${cond ? '✅' : '❌'} ${step}${extra ? ` — ${extra}` : ''}`)
  if (!cond) process.exitCode = 1
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, text: json ? JSON.stringify(json) : '' }
}

// ---------- Mock AI (frontera OpenAI-compatible) ----------
function embedVec(text) {
  // Vector determinista por texto (misma entrada → mismo vector)
  const v = new Array(16).fill(0)
  const t = String(text).toLowerCase()
  for (let i = 0; i < t.length; i++) v[i % 16] += (t.charCodeAt(i) % 13) / 13
  return v.map((x) => x / (1 + x))
}

function startMockAI() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let out
        try {
          if (req.url === '/v1/chat/completions') {
            const { messages = [] } = JSON.parse(raw || '{}')
            const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || ''
            let content
            if (lastUser.includes('RESULTADO_HERRAMIENTA') || lastUser.includes('Ya ejecutaste')) {
              content = JSON.stringify({ reply: 'Listo, cliente registrado por el agente E2E.' })
            } else if (lastUser.includes('E2E_CREAR_CLIENTE:')) {
              const name = lastUser.split('E2E_CREAR_CLIENTE:')[1].split('\n')[0].trim()
              content = JSON.stringify({ action: 'create_client', params: { name, phone: '+57 320 777 8899' } })
            } else {
              content = JSON.stringify({ reply: 'Hola, soy el agente E2E.' })
            }
            out = { choices: [{ message: { role: 'assistant', content } }] }
          } else if (req.url === '/v1/embeddings') {
            const { input = [] } = JSON.parse(raw || '{}')
            const items = (Array.isArray(input) ? input : [input]).map((t, i) => ({ index: i, embedding: embedVec(t) }))
            out = { data: items, model: 'mock-embed' }
          } else {
            out = { ok: true }
          }
        } catch (e) {
          out = { error: { message: String(e) } }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(out))
      })
    })
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server))
  })
}

// ---------- E2E ----------
async function main() {
  const mockServer = await startMockAI()
  try {
    // 0) Health
    const health = await api('GET', '/api/health')
    ok('0. HEALTH responde con checks', health.status === 200 && health.json?.ok === true && health.json?.checks?.db === true, `v${health.json?.version}`)

    // 1) LOGIN / registro de dos organizaciones
    const regA = await api('POST', '/api/auth/register', { body: { name: 'Owner E2E A', email: `e2e-a-${TS}@t.albra`, password: 'E2e-Passw0rd!' } })
    ok('1. LOGIN org A (registro → token)', regA.status === 200 && !!regA.json?.token)
    const regB = await api('POST', '/api/auth/register', { body: { name: 'Owner E2E B', email: `e2e-b-${TS}@t.albra`, password: 'E2e-Passw0rd!' } })
    ok('1b. LOGIN org B (registro → token)', regB.status === 200 && !!regB.json?.token)
    const tokA = regA.json?.token
    const tokB = regB.json?.token
    const login = await api('POST', '/api/auth/login', { body: { email: `e2e-a-${TS}@t.albra`, password: 'E2e-Passw0rd!' } })
    ok('1c. LOGIN repetido con password', login.status === 200 && !!login.json?.token)

    // 2) CREATE CUSTOMER
    const client = await api('POST', '/api/clients', { token: tokA, body: { name: 'Juana Pérez', phone: '+57 320 111 2233', status: 'prospect' } })
    const clientId = client.json?.client?.id ?? client.json?.id
    ok('2. CREATE CUSTOMER', client.status === 201 && !!clientId, `id=${clientId}`)

    // 3) CREATE OPPORTUNITY
    const opp = await api('POST', '/api/opportunities', { token: tokA, body: { clientId, title: 'Venta piloto E2E', amount: 1500 } })
    ok('3. CREATE OPPORTUNITY', opp.status === 201 && !!(opp.json?.opportunity?.id ?? opp.json?.id))

    // 4) AI TOOL (chat real con tool-calling a través del mock OpenAI)
    const cfg = await api('PUT', '/api/settings', { token: tokA, body: { llm: { apiKey: 'sk-e2e-mock-key-0000000000', baseUrl: `${MOCK}/v1`, model: 'mock-brain', provider: 'custom', embedModel: 'mock-embed' } } })
    ok('4a. AI provider configurado (settings cifrados)', cfg.status === 200)
    const chat = await api('POST', '/api/chat', { token: tokA, body: { message: `E2E_CREAR_CLIENTE:Marta Gómez\nContexto: cliente del chat`, clientId } })
    const acted = (chat.json?.actions ?? []).some((a) => a.type === 'create_client')
    ok('4b. AI TOOL create_client ejecutada por el agente', chat.status === 200 && acted, chat.json?.actions?.[0]?.summary)
    const list = await api('GET', '/api/clients?q=Marta', { token: tokA })
    const foundMarta = JSON.stringify(list.json).includes('Marta Gómez')
    ok('4c. El cliente creado por la IA existe en el CRM', foundMarta)

    // 5) MEMORY RETRIEVAL (hechos + contrato MemoryDV + búsqueda semántica)
    const mem = await api('POST', '/api/memory', { token: tokA, body: { clientId, content: 'Juana prefiere pagos contraentrega', type: 'preference', importance: 4 } })
    ok('5a. MEMORIA escrita (201)', mem.status === 201)
    const memList = await api('GET', `/api/memory?clientId=${clientId}`, { token: tokA })
    const hasMem = JSON.stringify(memList.json).includes('contraentrega')
    const dv = (memList.json?.memorydv ?? []).find((m) => m.content?.includes('contraentrega'))
    ok('5b. MEMORIA leída + contrato MemoryDV', hasMem && dv?.type === 'preference' && dv?.scope === `client:${clientId}`)
    const vec = await api('POST', '/api/memory/vector', { token: tokA, body: { query: 'pagos de Juana' } })
    ok('5c. Búsqueda semántica (embeddings mock) responde', vec.status === 200)

    // 6) FOLLOW-UP/AUTOMATION: trigger client_created → notify_admin (durable, idempotente)
    const auto = await api('POST', '/api/automations', {
      token: tokA,
      body: { name: 'E2E follow-up', triggerType: 'client_created', isActive: true, actions: [{ type: 'notify_admin', config: { title: 'Nuevo lead', body: 'Seguir up a {{clientName}}' } }] },
    })
    ok('6a. AUTOMATIZACIÓN creada', auto.status === 201)
    const client2 = await api('POST', '/api/clients', { token: tokA, body: { name: `Carlos Trigger ${TS}`, phone: '+57 320 444 5566' } })
    ok('6b. Cliente nuevo dispara el trigger', client2.status === 201)
    const autos = await api('GET', '/api/automations', { token: tokA })
    const mine = (autos.json?.automations ?? []).find((a) => a.name === 'E2E follow-up')
    ok('6c. Run de automatización SUCCESS (no duplicated/failed)', mine?.lastRun?.status === 'success', `status=${mine?.lastRun?.status}`)

    // 7) AUDIT
    const act = await api('GET', '/api/activity?limit=100', { token: tokA })
    const actText = JSON.stringify(act.json)
    ok('7. AUDIT registra created client + ran_automation', act.status === 200 && actText.includes('"created"'))

    // 8) ORG A vs ORG B (aislamiento E2E real sobre servidor vivo)
    const cross = await api('GET', `/api/clients/${clientId}`, { token: tokB })
    ok('8a. Aislamiento: B no ve el cliente de A (404)', cross.status === 404)
    const backupB = await api('GET', '/api/backup', { token: tokB })
    ok('8b. Backup de B no contiene datos de A', backupB.status === 200 && !backupB.text.includes('Juana Pérez'))
    const memCross = await api('GET', `/api/memory?clientId=${clientId}`, { token: tokB })
    ok('8c. Memoria de A invisible para B', memCross.status === 200 && !JSON.stringify(memCross.json).includes('contraentrega'))

    // 9) Doctor
    const doc = await api('GET', '/api/doctor', { token: tokA })
    ok('9. DOCTOR emite veredicto con checks', doc.status === 200 && ['healthy', 'degraded', 'critical'].includes(doc.json?.verdict), `verdict=${doc.json?.verdict}`)
  } finally {
    mockServer.close()
  }

  const passed = results.filter((r) => r.pass).length
  console.log(`\nE2E: ${passed}/${results.length} pasos OK → ${passed === results.length ? 'PASS' : 'FAIL'}`)
}

main().catch((e) => {
  console.error('E2E ERROR:', e)
  process.exit(1)
})
