#!/usr/bin/env node
// ============================================================
// CRM ALBRA — Smoke test de IA REAL (auditoría pre-venta P1)
//
// El E2E de cierre usa un proveedor OpenAI-compatible MOCK: sirve para
// probar la arquitectura pero NO demuestra integración real. Este script
// hace UNA llamada real de chat y UNA real de embeddings contra el
// proveedor configurado, SIN exponer credenciales (nunca imprime la key).
//
// Fuentes de credenciales (en orden):
//   1) Variables de entorno: LLM_BASE_URL + LLM_API_KEY (+ LLM_MODEL,
//      LLM_EMBED_MODEL) — p.ej. el proveedor NVIDIA/OpenAI/Groq del cliente.
//   2) La config cifrada de la organización en la BD (Settings.llmApiKeyEnc),
//      descifrada con APP_ENCRYPTION_KEY/APP_SECRET del .env.
//
// Resultados posibles (imprimidos tal cual para el informe):
//   REAL                      → chat + embeddings respondieron 200
//   REAL + CONFIGURACIÓN      → hay credenciales pero alguna llamada falló
//   NO VERIFICADO (BLOCKED BY EXTERNAL CREDENTIAL / PROVIDER)
//
// Uso: node scripts/ai-real-smoke.mjs [--db db/custom.db]
// Exit: 0 REAL · 2 REAL+CONFIGURACIÓN (credencial rechazada) · 3 NO VERIFICADO
// ============================================================

import Database from 'better-sqlite3'
import { createDecipheriv, createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dbArg = args[args.indexOf('--db') + 1] || 'db/custom.db'

function decryptSecret(payload, rawKey) {
  if (!payload) return null
  if (!payload.startsWith('v1:')) return payload // legacy plano
  try {
    const [, ivB64, tagB64, dataB64] = payload.split(':')
    const key = createHash('sha256').update(rawKey).digest()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

async function chatReal(baseUrl, apiKey, model) {
  const t0 = Date.now()
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Responde EXACTAMENTE con la palabra OK.' },
        { role: 'user', content: 'Di OK' },
      ],
      max_tokens: 5,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const ms = Date.now() - t0
  if (!res.ok) return { ok: false, ms, status: res.status, detail: (await res.text().catch(() => '')).slice(0, 200) }
  const j = await res.json().catch(() => null)
  const content = j?.choices?.[0]?.message?.content
  return content ? { ok: true, ms, status: res.status, detail: String(content).slice(0, 60) } : { ok: false, ms, status: res.status, detail: 'respuesta sin contenido' }
}

async function embedReal(baseUrl, apiKey, model) {
  const t0 = Date.now()
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || undefined, input: 'prueba de humo CRM ALBRA', input_type: 'query' }),
    signal: AbortSignal.timeout(30_000),
  })
  const ms = Date.now() - t0
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    // 404/400 sin modelo → endpoint de embeddings no disponible en ese proveedor
    return { ok: false, ms, status: res.status, detail }
  }
  const j = await res.json().catch(() => null)
  const v = j?.data?.[0]?.embedding
  return Array.isArray(v) && v.length > 0
    ? { ok: true, ms, status: res.status, dims: v.length }
    : { ok: false, ms, status: res.status, detail: 'respuesta sin embedding' }
}

async function main() {
  console.log('── IA REAL smoke (sin exponer credenciales) ──')

  // 1) Entorno
  let baseUrl = process.env.LLM_BASE_URL || null
  let apiKey = process.env.LLM_API_KEY || null
  let model = process.env.LLM_MODEL || null
  let embedModel = process.env.LLM_EMBED_MODEL || null
  let source = 'env (LLM_BASE_URL + LLM_API_KEY)'

  // 2) Config de la organización en BD (cifrada)
  if (!apiKey) {
    try {
      const db = new Database(join(ROOT, dbArg), { readonly: true })
      const rows = db.prepare('SELECT llmProvider, llmBaseUrl, llmModel, llmApiKeyEnc, llmEmbedModel FROM Settings WHERE llmApiKeyEnc IS NOT NULL LIMIT 1').all()
      db.close()
      const rawKey = process.env.APP_ENCRYPTION_KEY || process.env.APP_SECRET
      const s = rows[0]
      const dec = s ? decryptSecret(s.llmApiKeyEnc, rawKey) : null
      if (s && dec) {
        baseUrl = s.llmBaseUrl || baseUrl
        apiKey = dec
        model = s.llmModel || model
        embedModel = s.llmEmbedModel || embedModel
        source = `BD ${dbArg} (Settings de una organización, cifrada AES-256-GCM)`
      }
    } catch (e) {
      console.log(`(aviso: no pude leer config de BD: ${String(e.message || e).slice(0, 100)})`)
    }
  }

  if (!baseUrl || !apiKey) {
    console.log('RESULTADO: NO VERIFICADO — BLOCKED BY EXTERNAL CREDENTIAL / PROVIDER')
    console.log('  No hay credenciales reales disponibles (env ni config de organización).')
    console.log('  Para verificar: LLM_BASE_URL=https://integrate.api.nvidia.com/v1 LLM_API_KEY=... LLM_MODEL=... node scripts/ai-real-smoke.mjs')
    process.exit(3)
  }

  console.log(`Fuente de credenciales: ${source}`)
  console.log(`Proveedor: ${baseUrl} · modelo: ${model || '(default del proveedor)'} · key: ***${String(apiKey).slice(-3)}`)

  const chat = await chatReal(baseUrl, apiKey, model).catch((e) => ({ ok: false, ms: 0, status: 0, detail: String(e.message || e).slice(0, 120) }))
  console.log(`chat/completions → ${chat.ok ? 'OK' : 'FALLO'} (${chat.ms} ms, status ${chat.status}) ${chat.ok ? `→ "${chat.detail}"` : `→ ${chat.detail}`}`)

  const emb = await embedReal(baseUrl, apiKey, embedModel).catch((e) => ({ ok: false, ms: 0, status: 0, detail: String(e.message || e).slice(0, 120) }))
  console.log(`embeddings → ${emb.ok ? 'OK' : 'FALLO'} (${emb.ms} ms, status ${emb.status}) ${emb.ok ? `→ ${emb.dims} dims` : `→ ${emb.detail}`}`)

  if (chat.ok && emb.ok) {
    console.log('RESULTADO: REAL (chat + embeddings verificados contra el proveedor)')
    process.exit(0)
  }
  if (chat.ok || emb.ok) {
    console.log('RESULTADO: REAL + CONFIGURACIÓN (una llamada OK, otra falló — revisa modelo/embeddings del proveedor)')
    process.exit(2)
  }
  console.log('RESULTADO: REAL + CONFIGURACIÓN (credenciales presentes pero rechazadas por el proveedor — rota la key o revisa baseUrl/modelo)')
  process.exit(2)
}

main()
