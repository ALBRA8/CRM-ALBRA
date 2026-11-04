// Arranca WHATSPOWER (Nivel 2) completamente desacoplado del shell padre (doble fork),
// mismo patrón que start-dev-detached.mjs — sobrevive al reciclaje de llamadas del sandbox.
import { spawn } from 'child_process'
import { openSync } from 'fs'

const out = openSync('/tmp/wp-3003.log', 'a')
const child = spawn('node', ['--experimental-strip-types', 'src/server.ts'], {
  cwd: '/home/z/my-project/repos/WHATSPOWER',
  detached: true,
  stdio: ['ignore', out, out],
})
child.unref()
console.log('spawned pid', child.pid)
