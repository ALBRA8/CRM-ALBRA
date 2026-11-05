/**
 * Registro de sesiones Baileys por organización (P0.1 de la orden maestra).
 *
 * Módulo PURAMENTE LÓGICO: sin Baileys, sin red, sin base de datos. Lo consume
 * daemon.mjs y lo ejercitan los tests unitarios. Responsabilidades:
 *
 *  1. Validación estricta de orgId ANTES de construir rutas de disco
 *     (el orgId entra en una ruta de sistema de archivos: traversal prohibido).
 *  2. Resolución de la carpeta de credenciales POR ORGANIZACIÓN
 *     (.wa-auth/<orgId>/) en lugar de una sesión global compartida.
 *  3. Plan de arranque/migración: adopta el layout plano legado
 *     (.wa-auth/creds.json + session-org.json) hacia el layout por-org,
 *     SIN borrar información (la migración es un movimiento, no una eliminación).
 *  4. Política de /send sin orgId (compatibilidad con hosts standalone como
 *     WHATSPOWER/ULTRA): solo cuando existe EXACTAMENTE UNA sesión conectada
 *     (ambiguación imposible). Con dos o más, se EXIGE orgId (409) y con cero
 *     se rechaza (400). Fail-closed en multi-organización.
 */

import { join } from 'path'

/**
 * orgId seguro para rutas: solo alfanuméricos, guion y guion bajo (los cuid de
 * Prisma cumplen esto de sobra). 1–64 caracteres. Nada de puntos, barras ni
 * '..' — un orgId hostil jamás debe salir de .wa-auth/.
 */
const ORG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function validateOrgId(orgId) {
  return typeof orgId === 'string' && ORG_ID_RE.test(orgId)
}

/**
 * Carpeta de credenciales de UNA organización. Lanza si el orgId no es seguro:
 * fail-closed (el llamador debe rechazar la operación, nunca construir la ruta).
 */
export function authDirFor(authRoot, orgId) {
  if (!validateOrgId(orgId)) {
    throw new Error(`orgId inválido para ruta de sesión de WhatsApp: ${String(orgId).slice(0, 24)}`)
  }
  return join(authRoot, orgId)
}

/**
 * Estado de una sesión (tal como lo reporta /status y lo consume el proxy).
 * shape: { orgId, status, phone, lastUpdate, lastError }
 */

/** Sesiones conectadas (las únicas que pueden enviar mensajes). */
export function connectedSessions(sessions) {
  return (sessions || []).filter((s) => s && s.status === 'connected' && validateOrgId(s.orgId))
}

/**
 * Política de /send SIN orgId (llamadas de hosts standalone que no conocen
 * orgIds del CRM). Devuelve SIEMPRE una decisión explícita:
 *   { allow: true,  orgId }                       → exactamente una conectada
 *   { allow: false, code: 400|409, reason }       → cero o varias
 */
export function decideUnscopedSend(sessions) {
  const connected = connectedSessions(sessions)
  if (connected.length === 1) {
    return { allow: true, orgId: connected[0].orgId }
  }
  if (connected.length === 0) {
    return {
      allow: false,
      code: 400,
      reason: 'No hay ninguna sesión de WhatsApp conectada',
    }
  }
  return {
    allow: false,
    code: 409,
    reason: `orgId requerido: hay ${connected.length} sesiones de WhatsApp conectadas y el envío sin organización está prohibido (aislamiento multi-tenant)`,
  }
}

/**
 * Plan de arranque del daemon (puro): decide qué hacer con lo que hay en disco
 * SIN tocar nada. El daemon ejecuta las acciones (migración = movimiento).
 *
 * Entrada (todo serializable, inyectado por el daemon):
 *   rootEntries   : nombres de entradas de .wa-auth/ (fs.readdirSync)
 *   rootIsDir     : .wa-auth/ existe
 *   legacyOrgMeta : contenido parseado de .wa-auth/session-org.json o null
 *   orgExists     : (orgId) => boolean contra la BD
 *
 * Layout legado: creds.json DIRECTAMENTE en .wa-auth/ (una sola sesión global).
 * Layout nuevo : .wa-auth/<orgId>/creds.json (una carpeta por organización).
 *
 * Salida:
 *   { migrate: { from: 'legacy', to: orgId } | null,
 *     restore: [orgId],          // sesiones a auto-conectar al arrancar
 *     orphaned: [orgId],         // carpetas sin organización viva en BD (NO se borran)
 *     notes: [string] }
 */
export function planBootRestore({ rootEntries, rootIsDir, legacyOrgMeta, orgExists }) {
  const notes = []
  if (!rootIsDir) {
    return { migrate: null, restore: [], orphaned: [], notes: ['sin .wa-auth/: nada que restaurar'] }
  }
  const entries = Array.isArray(rootEntries) ? rootEntries : []

  // ¿Layout legado? creds.json en la raíz de .wa-auth/
  const legacyFlat = entries.includes('creds.json')
  let migrate = null
  if (legacyFlat) {
    const target = legacyOrgMeta && validateOrgId(legacyOrgMeta.orgId) ? legacyOrgMeta.orgId : null
    if (target && orgExists(target)) {
      migrate = { from: 'legacy', to: target }
      notes.push(`sesión legado (global) se migrará a .wa-auth/${target}/ (movimiento, sin borrado)`)
    } else {
      notes.push(
        'sesión legado SIN organización válida vinculada: se conserva intacta en disco y NO se conecta (fail-closed; borra .wa-auth/ o vincula la org para usarla)'
      )
    }
  }

  // Carpetas por-org ya existentes (o la que nacerá de la migración)
  const restore = []
  const orphaned = []
  const dirOrgIds = entries.filter((e) => validateOrgId(e))
  if (migrate && !dirOrgIds.includes(migrate.to)) dirOrgIds.push(migrate.to)
  for (const orgId of dirOrgIds) {
    if (orgExists(orgId)) restore.push(orgId)
    else orphaned.push(orgId)
  }
  if (orphaned.length) {
    notes.push(
      `carpetas de sesión sin organización viva en BD (se conservan en disco, no se conectan): ${orphaned.join(', ')}`
    )
  }
  return { migrate, restore, orphaned, notes }
}
