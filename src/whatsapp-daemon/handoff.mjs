/**
 * Handoff a humano para el daemon Baileys (Fase 5 — takeover manual).
 *
 * El cliente puede pedir explícitamente un humano con keywords configuradas en
 * NichoConfig.handoffKeywords (las MISMAS que ya usan los webhooks de
 * Telegram/Instagram vía channel-agent.ts). Cuando un mensaje entrante
 * coincide:
 *   1. El daemon pausa la IA en ESA conversación (isAutoReply = 0).
 *   2. Notifica al equipo vía /api/whatsapp/handoff (timeline + push).
 *   3. El mensaje del cliente SIEMPRE queda guardado (visible en la bandeja).
 *
 * Módulo puro e importable: daemon.mjs lo consume y los tests unitarios lo
 * ejercitan sin Baileys ni red.
 */

/**
 * Parsea el JSON crudo de NichoConfig.handoffKeywords → array de strings limpios.
 * Tolerante: JSON inválido, no-array o elementos no-string → [] (fail-closed).
 */
export function parseHandoffKeywords(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((k) => typeof k === 'string' && k.trim().length > 0)
      .map((k) => k.trim())
  } catch {
    return []
  }
}

/**
 * Coincidencia case-insensitive por inclusión (mismo criterio que
 * channel-agent.ts: `incomingText.toLowerCase().includes(keyword)`).
 * Vacío-safe: texto vacío o lista vacía → false.
 */
export function matchesHandoffKeyword(text, keywords) {
  if (!text || typeof text !== 'string') return false
  if (!Array.isArray(keywords) || keywords.length === 0) return false
  const lower = text.toLowerCase()
  return keywords.some((k) => typeof k === 'string' && k && lower.includes(k.toLowerCase()))
}

/**
 * Normaliza un nombre de asistente a TOKEN de comando: minúsculas, sin
 * acentos, primer bloque alfanumérico. "Luna" → "luna", "María Luz" → "maria".
 * Devuelve null si no queda token válido.
 */
export function normalizeCommandToken(name) {
  if (!name || typeof name !== 'string') return null
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  const m = clean.match(/[a-z0-9]+/)
  return m ? m[0] : null
}

/**
 * Comando de control de la IA enviado POR EL ASESOR HUMANO desde el teléfono
 * del negocio (mensajes fromMe del daemon). El cliente NUNCA puede activar o
 * pausar la IA con mensajes: el parser solo se aplica a fromMe en daemon.mjs.
 *
 * Sintaxis: "/<token> on" reactiva, "/<token> off" pausa. El token es "ia"
 * (siempre disponible como fallback) y el NOMBRE del asistente configurado
 * (ej. "/luna on" para el asistente "Luna" — con o sin acentos, cualquier
 * mayúscula). Case-insensitive y el marcador puede ir dentro de un mensaje
 * más largo, para que el cierre quede natural para el cliente (que solo ve
 * un mensaje del asesor), ej.:
 *   "¡Listo! Te atiende Luna /luna on"
 * Devuelve 'on' | 'off' | null.
 */
export function parseAiToggleCommand(text, extraNames = []) {
  if (!text || typeof text !== 'string') return null
  const names = Array.isArray(extraNames) ? extraNames : [extraNames]
  const tokens = ['ia']
  for (const n of names) {
    const t = normalizeCommandToken(n)
    if (t && !tokens.includes(t)) tokens.push(t)
  }
  // El TEXTO también se normaliza (sin acentos, minúsculas): "/MARÍA off"
  // matchea el token "maria" igual que "/maria off".
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const m = normalized.match(new RegExp(`/(${tokens.join('|')})\\s*(on|off)\\b`))
  if (!m) return null
  return m[2] === 'on' ? 'on' : 'off'
}

/**
 * Loader del NOMBRE del asistente configurado (NichoConfig.assistantName) con
 * caché TTL por organización — mismo patrón que las keywords. Nunca lanza:
 * error de DB → null (queda el comando "/ia on|off" de fallback).
 */
export function createAssistantNameLoader(db, { ttlMs = 60000 } = {}) {
  const cacheByOrg = new Map() // orgId → { name: string | null, loadedAt: number }
  return function loadAssistantName(orgId) {
    if (!orgId) return null
    const cached = cacheByOrg.get(orgId)
    if (cached && Date.now() - cached.loadedAt < ttlMs) return cached.name
    let name = null
    try {
      const row = db ? db.prepare('SELECT assistantName FROM NichoConfig WHERE organizationId = ?').get(orgId) : null
      if (row && typeof row.assistantName === 'string' && row.assistantName.trim()) {
        name = row.assistantName.trim().slice(0, 40)
      }
    } catch (err) {
      console.error('[handoff] No se pudo cargar el nombre del asistente:', err?.message || err)
    }
    cacheByOrg.set(orgId, { name, loadedAt: Date.now() })
    return name
  }
}

/**
 * Loader de keywords con caché TTL por organización. El daemon procesa cada
 * mensaje entrante; leer + parsear JSON en cada uno es barato pero evitable.
 * db se inyecta (better-sqlite3 ya abierto) para mantener el módulo puro.
 * Nunca lanza: error de DB → [] (la IA sigue respondiendo, fail-open coherente
 * con el resto del daemon).
 */
export function createHandoffKeywordLoader(db, { ttlMs = 60000 } = {}) {
  const cacheByOrg = new Map() // orgId → { keywords: string[], loadedAt: number }
  return function loadHandoffKeywords(orgId) {
    if (!orgId) return []
    const cached = cacheByOrg.get(orgId)
    if (cached && Date.now() - cached.loadedAt < ttlMs) return cached.keywords
    let keywords = []
    try {
      const row = db ? db.prepare('SELECT handoffKeywords FROM NichoConfig WHERE organizationId = ?').get(orgId) : null
      if (row && row.handoffKeywords) keywords = parseHandoffKeywords(row.handoffKeywords)
    } catch (err) {
      console.error('[handoff] No se pudieron cargar keywords (IA sigue activa):', err?.message || err)
    }
    cacheByOrg.set(orgId, { keywords, loadedAt: Date.now() })
    return keywords
  }
}

/**
 * Parsea la config cruda de NichoConfig.handoffNotifyPhones → array de
 * strings. Acepta JSON array O texto plano con saltos de línea / comas
 * (así lo escribe el textarea de Settings). Filtra vacíos, deduplica
 * case-insensitive y limita a 10 teléfonos (anti-abuso).
 * Tolerante: entrada inválida → [].
 */
export function parseHandoffNotifyPhones(raw) {
  let list = []
  if (raw == null) return []
  if (Array.isArray(raw)) {
    list = raw
  } else if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s)
      // String que parsea como JSON pero no es array = config errónea → fail-closed.
      if (Array.isArray(parsed)) list = parsed
      else return []
    } catch {
      list = s.split(/[\n,;]+/)
    }
  } else {
    return []
  }
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const v = item.trim()
    if (!v) continue
    // Validación mínima E.164: un teléfono real tiene entre 7 y 15 dígitos.
    // Descarta basura ('12345', nombres, notas) antes de que llegue a Baileys.
    const digitCount = (v.match(/\d/g) || []).length
    if (digitCount < 7 || digitCount > 15) continue
    const key = v.replace(/\D/g, '') || v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
    if (out.length >= 10) break
  }
  return out
}

/**
 * Normaliza un teléfono a JID-intl de WhatsApp: solo dígitos, y si parece
 * nacional (≤ 10 dígitos) le antepone el código de país inferido del teléfono
 * conectado del negocio (ej. negocio 573163301286 → nacional 3001234567 →
 * 573001234567). Sin teléfono de referencia no infiere nada.
 * Devuelve null si no quedan dígitos.
 *
 * @param {string | null} phone  teléfono crudo de la config
 * @param {string | null} businessPhone  teléfono conectado del negocio (para inferir código de país)
 * @returns {string | null}
 */
export function normalizeNotifyPhone(phone, businessPhone = null) {
  if (!phone || typeof phone !== 'string') return null
  let digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length <= 10 && businessPhone) {
    const bizDigits = String(businessPhone).replace(/\D/g, '')
    if (bizDigits.length > 10) {
      const cc = bizDigits.slice(0, bizDigits.length - 10)
      if (cc.length >= 1 && cc.length <= 3) digits = cc + digits
    }
  }
  return digits
}

/**
 * Loader de teléfonos a notificar (NichoConfig.handoffNotifyPhones) con
 * caché TTL por organización — mismo patrón que keywords/assistantName.
 * Devuelve teléfonos normalizados a dígitos intl. Fail-open: error DB → [].
 * businessPhone se resuelve con un callback perezoso (el daemon ya conoce el
 * teléfono conectado, pero puede llegar después del primer arranque).
 *
 * @param {unknown} db  better-sqlite3 ya abierto (o null en tests)
 * @param {{ ttlMs?: number, getBusinessPhone?: (() => string | null) | null }} [options]
 */
export function createHandoffNotifyPhonesLoader(db, { ttlMs = 60000, getBusinessPhone = null } = {}) {
  const cacheByOrg = new Map() // orgId → { phones: string[], loadedAt: number }
  return function loadHandoffNotifyPhones(orgId) {
    if (!orgId) return []
    const cached = cacheByOrg.get(orgId)
    if (cached && Date.now() - cached.loadedAt < ttlMs) return cached.phones
    let phones = []
    try {
      const row = db ? db.prepare('SELECT handoffNotifyPhones FROM NichoConfig WHERE organizationId = ?').get(orgId) : null
      if (row && row.handoffNotifyPhones) {
        const biz = typeof getBusinessPhone === 'function' ? getBusinessPhone() : null
        phones = parseHandoffNotifyPhones(row.handoffNotifyPhones)
          .map((p) => normalizeNotifyPhone(p, biz))
          .filter(Boolean)
      }
    } catch (err) {
      console.error('[handoff] No se pudieron cargar los teléfonos de notificación:', err?.message || err)
    }
    cacheByOrg.set(orgId, { phones, loadedAt: Date.now() })
    return phones
  }
}
