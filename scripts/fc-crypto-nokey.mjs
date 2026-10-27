// FAIL-CLOSED: crypto.ts del CRM sin APP_ENCRYPTION_KEY/APP_SECRET debe fallar
// con error de configuración (nunca cifrar con clave pública/derivada vacía).
try {
  const { encryptSecret } = await import('/home/z/repos-limpio/CRM-ALBRA/src/lib/crypto.ts')
  const out = encryptSecret('no-debe-cifrar')
  if (out === null) { console.log('CONFIG-ERROR-OK (encryptSecret devolvió null sin clave)'); process.exit(0) }
  console.log('FALLO: cifró sin clave')
  process.exit(1)
} catch (e) {
  console.log('CONFIG-ERROR-OK (' + String(e.message).split('\n')[0].slice(0, 60) + ')')
  process.exit(0)
}
