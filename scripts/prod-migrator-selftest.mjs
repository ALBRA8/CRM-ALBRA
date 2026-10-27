// SELFTEST migrador dual-key APP_ENCRYPTION_KEY — ventana de producción R2.
// Usa el crypto.ts REAL del CRM (AES-256-GCM, formato v1:iv:tag:data).
// Ningún valor de clave se imprime: solo resultados PASS/FAIL.
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret } from '/home/z/repos-limpio/CRM-ALBRA/src/lib/crypto.ts'

const results = []
function check(id, cond, detail = '') {
  results.push({ id, ok: Boolean(cond), detail })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`)
}

// Claves sintéticas en memoria (nunca impresas, nunca persistidas)
const OLD_KEY = randomBytes(32).toString('hex')
const NEW_KEY = randomBytes(32).toString('hex')

// Estado inicial: clave VIEJA activa (simula producción con datos existentes)
process.env.APP_ENCRYPTION_KEY = OLD_KEY
const payloadOld = encryptSecret('dato-sensible-prueba-r2')
check('M1 cifra con clave VIEJA formato v1:*', typeof payloadOld === 'string' && payloadOld.startsWith('v1:'))

// Cambio de clave sin migración: los datos antiguos quedan indescifrables (por eso existe el migrador)
process.env.APP_ENCRYPTION_KEY = NEW_KEY
check('M2 con clave NUEVA el payload VIEJO es indescifrable (no-fuga)', decryptSecret(payloadOld) === null)

// MIGRACIÓN dual-key: descifra con VIEJA, re-cifra con NUEVA
process.env.APP_ENCRYPTION_KEY = OLD_KEY
const plain = decryptSecret(payloadOld)
check('M3 descifra con VIEJA antes de migrar', plain === 'dato-sensible-prueba-r2')
process.env.APP_ENCRYPTION_KEY = NEW_KEY
const payloadNew = encryptSecret(plain)
check('M4 re-cifrado con NUEVA produce v1:* distinto (IV fresco)', typeof payloadNew === 'string' && payloadNew.startsWith('v1:') && payloadNew !== payloadOld)
check('M5 descifra con NUEVA tras migración (dato intacto)', decryptSecret(payloadNew) === 'dato-sensible-prueba-r2')

// VIEJA inutilizada tras la migración
process.env.APP_ENCRYPTION_KEY = OLD_KEY
check('M6 clave VIEJA ya no descifra los datos migrados', decryptSecret(payloadNew) === null)

// Preservación: plaintext legacy intacto y payloads corruptos no revientan
process.env.APP_ENCRYPTION_KEY = NEW_KEY
check('M7 plaintext legacy pasa intacto (sin v1:)', decryptSecret('valor-plano-legacy') === 'valor-plano-legacy')
check('M8 payload corrupto → null sin crash', decryptSecret('v1:basura:corrupta') === null)

// Estado final de la ventana: roundtrip directo con la clave NUEVA real del entorno
const fs = await import('node:fs')
const envText = fs.readFileSync('/home/z/repos-limpio/CRM-ALBRA/.env', 'utf8')
const m = envText.match(/^APP_ENCRYPTION_KEY=(.+)$/m)
process.env.APP_ENCRYPTION_KEY = m[1]
const rt = encryptSecret('roundtrip-r2-' + randomBytes(4).toString('hex'))
check('M9 roundtrip con APP_ENCRYPTION_KEY real del .env (clave nueva)', decryptSecret(rt) !== null && decryptSecret(rt).startsWith('roundtrip-r2-'))

const fails = results.filter(r => !r.ok).length
console.log(`SELFTEST MIGRADOR: ${results.length - fails}/${results.length} PASS`)
process.exit(fails ? 1 : 0)
