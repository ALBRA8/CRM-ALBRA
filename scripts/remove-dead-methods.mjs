#!/usr/bin/env node
/**
 * Remueve métodos muertos de src/lib/api.ts por name + brace-matching.
 * Uso: node scripts/remove-dead-methods.mjs
 */
import fs from 'fs'

const FILE = 'src/lib/api.ts'
const DEAD = new Set([
  'getOpportunity', 'getWhatsAppQr', 'connectWhatsApp', 'disconnectWhatsApp',
  'sendTelegramMessage', 'sendInstagramMessage', 'getInstagramConversations',
  'getInstagramConversation', 'updateInstagramConversation', 'connectGoogle',
  'sendGmail', 'getCalendarEvents', 'createCalendarEvent', 'readSheet',
  'getInventoryStatus', 'getMemory', 'addMemory', 'createNotification',
  'clearNotifications', 'getPermissions', 'sendEmail', 'exportBackup',
  'importBackup', 'forgotPassword', 'resetPassword',
])

let src = fs.readFileSync(FILE, 'utf8')
let removed = 0

// Cada método: "  async name(" o "  name(" seguido de bloque balanceado.
const methodRe = /^ {2}(?:async )?([a-zA-Z0-9_]+)\s*\(/gm
const cuts = []
for (const m of src.matchAll(methodRe)) {
  if (!DEAD.has(m[1])) continue
  const start = m.index
  // Retrocede hasta el inicio de la línea (incluye comentario JSDoc inmediato arriba)
  let lineStart = src.lastIndexOf('\n', start) + 1
  let docStart = lineStart
  const before = src.slice(0, lineStart)
  const docMatch = before.match(/\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*$/)
  if (docMatch) docStart = before.length - docMatch[0].length
  // Brace matching desde la primera { después del paréntesis de apertura
  let i = src.indexOf('{', m.index)
  if (i === -1) continue
  let depth = 0
  for (; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  // Hasta el final de línea del closing brace
  let end = src.indexOf('\n', i)
  end = end === -1 ? src.length : end + 1
  cuts.push([docStart, end, m[1]])
  removed++
}

// Corta de atrás hacia adelante para no invalidar índices
cuts.sort((a, b) => b[0] - a[0])
for (const [s, e] of cuts) src = src.slice(0, s) + src.slice(e)

fs.writeFileSync(FILE, src)
console.log(`Métodos removidos: ${removed}/${DEAD.size}`)
console.log(cuts.map((c) => c[2]).sort().join(', '))
