// Test sintético del FIX BARRERA 3 — evalúa la expresión REAL extraída de
// src/whatsapp-daemon/daemon.mjs contra 4 casos de JIDs. Sin tocar WhatsApp.
import { readFileSync } from 'fs'

const src = readFileSync('/home/z/my-project/src/whatsapp-daemon/daemon.mjs', 'utf8')

// Extrae la expresión completa del fix (const contactPhone = ...; hasta contactName)
const m = src.match(/const contactPhone = isOwner\s*\?\s*from\.split\('@'\)\[0\]\s*:\s*\(msg\.key\.senderPn \|\| from\)\.split\('@'\)\[0\]/)
if (!m) { console.error('FALLO: la expresión del fix no se encontró en daemon.mjs'); process.exit(1) }
const expr = m[0]

function evalCase({ isOwner, remoteJid, senderPn }) {
  const msg = { key: { fromMe: isOwner, remoteJid, senderPn } }
  const from = msg.key.remoteJid
  return new Function('isOwner', 'msg', 'from', `${expr}; return contactPhone`)(isOwner, msg, from)
}

const cases = [
  { name: 'inbound con LID + senderPn → teléfono real', isOwner: false, remoteJid: '215779999999999@lid', senderPn: '573001112233@s.whatsapp.net', expected: '573001112233' },
  { name: 'inbound con LID sin senderPn → fallback LID (comportamiento previo)', isOwner: false, remoteJid: '215779999999999@lid', senderPn: undefined, expected: '215779999999999' },
  { name: 'inbound JID telefónico clásico sin senderPn → teléfono', isOwner: false, remoteJid: '573001112233@s.whatsapp.net', senderPn: undefined, expected: '573001112233' },
  { name: 'fromMe (dueño) → remoteJid sin cambios', isOwner: true, remoteJid: '215779999999999@lid', senderPn: '573009998887@s.whatsapp.net', expected: '215779999999999' },
]

let pass = 0
for (const c of cases) {
  const got = evalCase(c)
  const ok = got === c.expected
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${c.name} | got=${got} expected=${c.expected}`)
}
console.log(`\nRESULTADO: ${pass}/${cases.length} PASS`)
process.exit(pass === cases.length ? 0 : 1)
