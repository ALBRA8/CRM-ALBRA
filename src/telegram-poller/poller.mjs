#!/usr/bin/env node
/**
 * Telegram Poller — CRM ALBRA
 *
 * Recibe actualizaciones de Telegram SIN dominio público (getUpdates long-polling)
 * y las entrega al MISMO pipeline del webhook (/api/telegram/webhook) firmadas con
 * el secret por organización. Así la IA, ASR, handoff y trazabilidad son idénticos
 * al modo webhook — solo cambia el transporte.
 *
 * Comportamiento:
 *  - Por cada Integration con enableTelegram + telegramSecret + token: long-poll de
 *    getUpdates (25s) y POST de cada update al webhook del CRM con el header
 *    X-Telegram-Bot-Api-Secret-Token.
 *  - Offset por organización persistido en db/telegram-poller-state.json (write atómico).
 *  - HTTP 409 (webhook activo en Telegram) → cooldown de 60s: el webhook tiene
 *    prioridad; el poller NO compite (Telegram solo permite un consumidor).
 *  - 3 fallos seguidos de entrega para el mismo update → se avanza el offset y se
 *    registra el error (evita bucles infinitos; el mensaje queda en timeline si
 *    llegó a procesarse, y en el log si no).
 *  - Nunca imprime tokens ni secrets (solo orgId / update_id / códigos HTTP).
 *
 * Variables de entorno:
 *  - CRM_BASE_URL (default http://localhost:3000) — destino de los updates.
 *  - TELEGRAM_API_BASE (default https://api.telegram.org) — override SOLO para E2E.
 *  - TG_POLLER_STATE_FILE (default <proyecto>/db/telegram-poller-state.json)
 *  - TG_POLLER_IDLE_MS (default 5000) — espera entre ciclos sin orgs / tras error.
 *
 * Apagado limpio: SIGTERM/SIGINT. Alta de dominio futuro: detener este proceso y
 * usar /api/telegram/set-webhook (el webhook toma el relevo automáticamente: 409).
 */

import { PrismaClient } from '@prisma/client'
import { createDecipheriv, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')

const CRM_BASE = (process.env.CRM_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const TG_API = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')
const STATE_FILE = process.env.TG_POLLER_STATE_FILE || resolve(PROJECT_ROOT, 'db/telegram-poller-state.json')
const IDLE_MS = Number(process.env.TG_POLLER_IDLE_MS || 5_000)
const LONG_POLL_S = 25
const MAX_DELIVERY_FAILURES = 3
const WEBHOOK_CONFLICT_COOLDOWN_MS = 60_000

const db = new PrismaClient()

// ---------- cifrado (mismo formato v1 que src/lib/crypto.ts: AES-256-GCM) ----------
function getKey() {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.APP_SECRET
  if (!raw) throw new Error('APP_ENCRYPTION_KEY/APP_SECRET no configurados')
  return createHash('sha256').update(raw).digest()
}
function decryptSecret(payload) {
  if (!payload) return null
  try {
    if (!payload.startsWith('v1:')) return payload // legacy plano
    const [, ivB64, tagB64, dataB64] = payload.split(':')
    const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
function parseTelegramState(enc) {
  const raw = decryptSecret(enc)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return { token: raw }
  }
}

// ---------- offsets persistidos ----------
let offsets = {}
try {
  offsets = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
} catch {
  offsets = {}
}
function persistOffsets() {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    const tmp = `${STATE_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(offsets, null, 2))
    renameSync(tmp, STATE_FILE)
  } catch (err) {
    console.error('[tg-poller] no se pudo persistir offset', err.message)
  }
}

// ---------- ciclo principal ----------
let shuttingDown = false
const webhookCooldownUntil = new Map() // orgId → ts

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchUpdates(token, orgId) {
  const offset = offsets[orgId] || 0
  const res = await fetch(`${TG_API}/bot${token}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset, timeout: LONG_POLL_S, allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'] }),
    signal: AbortSignal.timeout((LONG_POLL_S + 10) * 1000),
  })
  if (res.status === 409) {
    // Un webhook activo es el consumidor: el poller retrocede sin error ruidoso.
    webhookCooldownUntil.set(orgId, Date.now() + WEBHOOK_CONFLICT_COOLDOWN_MS)
    console.log(`[tg-poller] org ${orgId}: webhook activo en Telegram (409) — cooldown ${WEBHOOK_CONFLICT_COOLDOWN_MS / 1000}s`)
    return null
  }
  if (!res.ok) {
    console.error(`[tg-poller] org ${orgId}: getUpdates HTTP ${res.status}`)
    return null
  }
  const data = await res.json().catch(() => null)
  if (!data?.ok || !Array.isArray(data.result)) return null
  return data.result
}

async function deliver(orgId, secret, update) {
  let failures = 0
  while (!shuttingDown) {
    try {
      const res = await fetch(`${CRM_BASE}/api/telegram/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': secret,
        },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(120_000), // la IA puede tardar (auto-respuesta)
      })
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body?.ok === false) throw new Error('webhook respondió ok:false')
        return true
      }
      console.error(`[tg-poller] org ${orgId}: webhook HTTP ${res.status} para update ${update.update_id}`)
    } catch (err) {
      console.error(`[tg-poller] org ${orgId}: entrega falló (update ${update.update_id}):`, err.message)
    }
    failures += 1
    if (failures >= MAX_DELIVERY_FAILURES) {
      console.error(`[tg-poller] org ${orgId}: update ${update.update_id} descartado tras ${failures} fallos (no se bloquea el canal)`)
      return false
    }
    await sleep(2000)
  }
  return false
}

async function cycle() {
  const integrations = await db.integration.findMany({
    where: { enableTelegram: true, telegramSecret: { not: null } },
    select: { organizationId: true, telegramSecret: true, telegramBotTokenEnc: true },
  })

  let polled = 0
  for (const integration of integrations) {
    if (shuttingDown) break
    const orgId = integration.organizationId
    const state = parseTelegramState(integration.telegramBotTokenEnc)
    if (!state.token) continue
    if ((webhookCooldownUntil.get(orgId) || 0) > Date.now()) continue

    try {
      const updates = await fetchUpdates(state.token, orgId)
      polled += 1
      if (!updates || updates.length === 0) continue
      for (const update of updates) {
        if (shuttingDown) break
        const delivered = await deliver(orgId, integration.telegramSecret, update)
        // Offset avanza siempre tras intentar la entrega (éxito o descarte tras
        // reintentos); solo se conserva si el proceso se está apagando a mitad.
        if (!shuttingDown) {
          offsets[orgId] = Math.max(offsets[orgId] || 0, update.update_id + 1)
          persistOffsets()
        }
      }
    } catch (err) {
      console.error(`[tg-poller] org ${orgId}: ciclo con error:`, err.message)
    }
  }
  return polled
}

async function main() {
  console.log(`[tg-poller] iniciado — CRM: ${CRM_BASE}, Telegram API: ${TG_API}`)
  while (!shuttingDown) {
    try {
      const polled = await cycle()
      if (polled === 0) await sleep(IDLE_MS)
    } catch (err) {
      console.error('[tg-poller] ciclo principal:', err.message)
      await sleep(IDLE_MS)
    }
  }
  console.log('[tg-poller] apagado limpio')
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    shuttingDown = true
    persistOffsets()
  })
}

main()
  .catch((err) => {
    console.error('[tg-poller] fatal:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
