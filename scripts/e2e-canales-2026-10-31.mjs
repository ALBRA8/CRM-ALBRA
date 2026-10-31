#!/usr/bin/env node
/**
 * E2E CANALES — 2026-10-31
 *
 * Prueba el camino REAL de los 3 canales del CRM contra mocks locales de las APIs
 * externas (Telegram Bot API + Meta Graph). El código del CRM (webhooks, IA, inbox,
 * timeline, envío) corre tal cual; solo el transporte externo es un mock.
 *
 * A) Telegram  : poller (getUpdates) → POST /api/telegram/webhook (secret) → IA → sendMessage (mock)
 * B) Instagram : GET verify (challenge) + POST firmado X-Hub-Signature-256 → IA → /me/messages (mock)
 * C) Facebook  : GET verify (challenge) + POST firmado → IA → /{pageId}/messages (mock)
 * D) Negativos : firmas inválidas → 401 (IG y FB), secret TG equivocado → 401
 *
 * Limpieza: borra la org E2E (cascade), mata el poller y los mocks.
 * NO imprime secretos; los valores E2E son ficticios y viven solo en esta BD de prueba.
 */

import { createServer } from 'node:http'
import { createHmac, createCipheriv, createHash, randomBytes } from 'node:crypto'
import { spawn } from 'child_process'
import { readFileSync, unlinkSync, rmSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const PROJECT = '/home/z/my-project'
const TG_MOCK_PORT = 3015
const GRAPH_MOCK_PORT = 3016
const CRM = 'http://localhost:3000'

const prisma = new PrismaClient()
const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// ---------- cifrado (mismo formato v1 que src/lib/crypto.ts) ----------
// CLAVE: el CRM (next dev) hereda APP_ENCRYPTION_KEY del entorno del shell, que
// tiene precedencia sobre .env. El E2E usa la MISMA fuente para cifrar.
function loadEncryptionKey() {
  if (process.env.APP_ENCRYPTION_KEY) return process.env.APP_ENCRYPTION_KEY
  if (process.env.APP_SECRET) return process.env.APP_SECRET
  const env = readFileSync(`${PROJECT}/.env`, 'utf8')
  const m = env.match(/^APP_ENCRYPTION_KEY=(.+)$/m)
  if (!m) throw new Error('APP_ENCRYPTION_KEY no encontrado (ni en entorno ni en .env)')
  return m[1].trim()
}
const APP_KEY = loadEncryptionKey()
function encryptSecret(plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(APP_KEY).digest(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}

// ---------- mocks de APIs externas ----------
const tgSent = []     // { token, body } de sendMessage
let tgQueued = []     // updates pendientes de getUpdates
const graphSent = []  // { path, body } de /me/messages y /{pageId}/messages

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

const tgMock = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const url = req.url || ''
    if (url.includes('/getUpdates')) {
      const out = tgQueued
      tgQueued = []
      return json(res, 200, { ok: true, result: out })
    }
    if (url.includes('/sendMessage')) {
      tgSent.push({ token: url.split('/bot')[1]?.split('/')[0], body: JSON.parse(raw || '{}') })
      return json(res, 200, { ok: true, result: { message_id: 1 } })
    }
    json(res, 200, { ok: true, result: {} })
  })
})

const graphMock = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const url = (req.url || '').split('?')[0]
    if (url.endsWith('/messages')) {
      graphSent.push({ path: url, body: JSON.parse(raw || '{}') })
      return json(res, 200, { message_id: 'mid_mock_1' })
    }
    json(res, 200, { ok: true })
  })
})

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitFor(pred, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await wait(1500)
  }
  console.error(`timeout esperando: ${label}`)
  return false
}

// Meta HMAC
function metaSign(rawBody, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

async function main() {
  // 0) mocks arriba
  await new Promise((r) => tgMock.listen(TG_MOCK_PORT, r))
  await new Promise((r) => graphMock.listen(GRAPH_MOCK_PORT, r))
  console.log(`mocks arriba: Telegram :${TG_MOCK_PORT}, Graph :${GRAPH_MOCK_PORT}`)

  // 1) org E2E + integraciones (secretos ficticios, cifrados como en producción)
  const orgId = 'e2e-canales-2026'
  await prisma.organization.upsert({
    where: { id: orgId },
    create: { id: orgId, name: 'E2E Canales 2026-10-31', slug: 'e2e-canales-2026' },
    update: { name: 'E2E Canales 2026-10-31' },
  })
  await prisma.integration.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      telegramSecret: 'e2e-tg-secret-0123456789abcdef',
      telegramBotTokenEnc: encryptSecret(JSON.stringify({ token: '123456:TEST-TOKEN', autoReply: true })),
      enableTelegram: true,
      instagramTokenEnc: encryptSecret(JSON.stringify({ token: 'IG-TEST-TOKEN', webhookVerifyToken: 'e2e-ig-verify', webhookSecret: 'e2e-ig-appsecret' })),
      instagramAccountId: '1789E2EIG',
      enableInstagram: true,
      facebookTokenEnc: encryptSecret(JSON.stringify({ pageToken: 'FB-PAGE-TOKEN', webhookVerifyToken: 'e2e-fb-verify' })),
      facebookPageId: '1000E2EFB',
      metaAppSecretEnc: encryptSecret('e2e-fb-appsecret'),
      enableFacebook: true,
    },
    update: {
      telegramSecret: 'e2e-tg-secret-0123456789abcdef',
      telegramBotTokenEnc: encryptSecret(JSON.stringify({ token: '123456:TEST-TOKEN', autoReply: true })),
      enableTelegram: true,
      instagramTokenEnc: encryptSecret(JSON.stringify({ token: 'IG-TEST-TOKEN', webhookVerifyToken: 'e2e-ig-verify', webhookSecret: 'e2e-ig-appsecret' })),
      instagramAccountId: '1789E2EIG',
      enableInstagram: true,
      facebookTokenEnc: encryptSecret(JSON.stringify({ pageToken: 'FB-PAGE-TOKEN', webhookVerifyToken: 'e2e-fb-verify' })),
      facebookPageId: '1000E2EFB',
      metaAppSecretEnc: encryptSecret('e2e-fb-appsecret'),
      enableFacebook: true,
    },
  })
  console.log('org E2E sembrada')

  // 2) poller con mock de Telegram
  try { unlinkSync('/tmp/tg-poller-e2e-state.json') } catch {}
  const poller = spawn('node', ['src/telegram-poller/poller.mjs'], {
    cwd: PROJECT,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      TELEGRAM_API_BASE: `http://localhost:${TG_MOCK_PORT}`,
      TG_POLLER_STATE_FILE: '/tmp/tg-poller-e2e-state.json',
      TG_POLLER_IDLE_MS: '1000',
      CRM_BASE_URL: CRM,
    },
  })
  poller.unref()
  console.log('poller pid', poller.pid)

  try {
    // ============ A) TELEGRAM vía poller ============
    tgQueued = [{
      update_id: 1001,
      message: {
        message_id: 1,
        from: { id: 777, first_name: 'Elena', username: 'elena_e2e' },
        chat: { id: 777, type: 'private' },
        text: 'Hola, vi su anuncio y quiero una cita para esta semana',
      },
    }]
    const tgReplied = await waitFor(() => tgSent.length > 0, 150_000, 'respuesta IA por Telegram')
    record('TG: update entregado por poller y auto-respuesta IA enviada (mock sendMessage)', tgReplied,
      tgReplied ? `texto: "${(tgSent[0]?.body?.text || '').slice(0, 60)}…"` : 'sin sendMessage en mock')

    const tgClient = await prisma.client.findFirst({ where: { organizationId: orgId, phone: 'tg:777' } })
    record('TG: cliente find-or-create (phone=tg:777)', !!tgClient, tgClient?.name || '')
    const tgEvents = await prisma.timelineEvent.findMany({ where: { organizationId: orgId, type: 'telegram', clientId: tgClient?.id } })
    const tgIn = tgEvents.some((e) => { try { return JSON.parse(e.metadata || '{}').direction === 'in' } catch { return false } })
    const tgOut = tgEvents.some((e) => { try { const m = JSON.parse(e.metadata || '{}'); return m.direction === 'out' && m.delivered === true } catch { return false } })
    record('TG: timeline in/out con delivered=true', tgIn && tgOut, `${tgEvents.length} eventos`)

    // ============ B) INSTAGRAM webhook firmado ============
    // GET verify
    const vres = await fetch(`${CRM}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=e2e-ig-verify&hub.challenge=CHALLENGE_IG_123`)
    const vtext = await vres.text()
    record('IG: verificación hub.challenge (text/plain 200)', vres.status === 200 && vtext === 'CHALLENGE_IG_123', `HTTP ${vres.status}`)

    const igBody = JSON.stringify({
      object: 'instagram',
      entry: [{ id: '1789E2EIG', messaging: [{ sender: { id: '555' }, recipient: { id: '1789E2EIG' }, message: { mid: 'm1', text: 'Buenas! Tienen disponibilidad esta semana?' } }] }],
    })
    const igCountBefore = graphSent.length
    const igRes = await fetch(`${CRM}/api/instagram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': metaSign(igBody, 'e2e-ig-appsecret') },
      body: igBody,
    })
    record('IG: POST firmado aceptado (200 ok)', igRes.ok, `HTTP ${igRes.status}`)
    const igReplied = await waitFor(() => graphSent.length > igCountBefore, 150_000, 'respuesta IA por Instagram')
    record('IG: auto-respuesta IA vía Graph (mock /me/messages)', igReplied,
      igReplied ? `destino: ${JSON.stringify(graphSent[graphSent.length - 1]?.body?.recipient)} texto: "${(graphSent[graphSent.length - 1]?.body?.message?.text || '').slice(0, 50)}…"` : '')
    const igClient = await prisma.client.findFirst({ where: { organizationId: orgId, phone: 'ig:555' } })
    record('IG: cliente find-or-create (phone=ig:555)', !!igClient)

    const igBad = await fetch(`${CRM}/api/instagram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': metaSign(igBody, 'secreto-equivocado') },
      body: igBody,
    })
    record('IG: firma inválida rechazada (401)', igBad.status === 401, `HTTP ${igBad.status}`)

    // ============ C) FACEBOOK webhook firmado ============
    const fvres = await fetch(`${CRM}/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=e2e-fb-verify&hub.challenge=CHALLENGE_FB_456`)
    const fvtext = await fvres.text()
    record('FB: verificación hub.challenge (text/plain 200)', fvres.status === 200 && fvtext === 'CHALLENGE_FB_456', `HTTP ${fvres.status}`)

    const fbBody = JSON.stringify({
      object: 'page',
      entry: [{ id: '1000E2EFB', messaging: [{ sender: { id: '666' }, recipient: { id: '1000E2EFB' }, message: { mid: 'f1', text: 'Cuánto cuesta la suscripción anual?' } }] }],
    })
    const fbCountBefore = graphSent.length
    const fbRes = await fetch(`${CRM}/api/facebook/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': metaSign(fbBody, 'e2e-fb-appsecret') },
      body: fbBody,
    })
    record('FB: POST firmado aceptado (200 ok)', fbRes.ok, `HTTP ${fbRes.status}`)
    const fbReplied = await waitFor(() => graphSent.length > fbCountBefore, 150_000, 'respuesta IA por Facebook')
    record('FB: auto-respuesta IA vía Graph (mock /{pageId}/messages)', fbReplied,
      fbReplied ? `path: ${graphSent[graphSent.length - 1]?.path}` : '')
    const fbClient = await prisma.client.findFirst({ where: { organizationId: orgId, phone: 'fb:666' } })
    record('FB: cliente find-or-create (phone=fb:666)', !!fbClient)

    const fbBad = await fetch(`${CRM}/api/facebook/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': metaSign(fbBody, 'otro-secreto-malo') },
      body: fbBody,
    })
    record('FB: firma inválida rechazada (401)', fbBad.status === 401, `HTTP ${fbBad.status}`)

    // ============ D) Telegram: secret equivocado (camino poller directo) ============
    const tgBad = await fetch(`${CRM}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'secret-que-no-existe' },
      body: JSON.stringify({ update_id: 9999, message: { message_id: 9, chat: { id: 1, type: 'private' }, text: 'x' } }),
    })
    record('TG: secret inválido rechazado (401)', tgBad.status === 401, `HTTP ${tgBad.status}`)

    // ============ E) Inbox unificado contiene los 3 clientes nuevos ============
    const timelineByType = {
      telegram: await prisma.timelineEvent.count({ where: { organizationId: orgId, type: 'telegram' } }),
      instagram: await prisma.timelineEvent.count({ where: { organizationId: orgId, type: 'instagram' } }),
      facebook: await prisma.timelineEvent.count({ where: { organizationId: orgId, type: 'facebook' } }),
    }
    record('Inbox: timeline de los 3 canales poblado (fuente de la bandeja unificada)',
      timelineByType.telegram > 0 && timelineByType.instagram > 0 && timelineByType.facebook > 0,
      JSON.stringify(timelineByType))
  } finally {
    // limpieza
    try { process.kill(-poller.pid, 'SIGTERM') } catch { try { poller.kill('SIGTERM') } catch {} }
    try { rmSync('/tmp/tg-poller-e2e-state.json', { force: true }) } catch {}
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {})
    console.log('limpieza: org E2E eliminada (cascade), poller detenido')
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n========== RESUMEN E2E CANALES ==========')
  console.log(`Total: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`)
  for (const f of failed) console.log(`  FAIL: ${f.name} ${f.detail}`)
  process.exitCode = failed.length ? 1 : 0
}

main()
  .catch((err) => {
    console.error('E2E fatal:', err)
    process.exitCode = 1
  })
  .finally(() => {
    tgMock.close()
    graphMock.close()
    prisma.$disconnect()
  })
