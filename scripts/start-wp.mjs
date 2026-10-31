// Arranca WHATSPOWER (:3003) completamente desacoplado del shell padre (doble fork).
// Log: scripts/logs/wp.log. El .env de WP (600, gitignored) lleva PORT/AGENTIC_2A_WEBHOOK_SECRET.
import { spawn } from 'child_process'
import { openSync } from 'fs'

const out = openSync('/home/z/my-project/scripts/logs/wp.log', 'a')
const child = spawn('node', ['--experimental-strip-types', 'src/server.ts'], {
  cwd: '/home/z/repos-limpio/WHATSPOWER',
  detached: true,
  stdio: ['ignore', out, out],
  env: { ...process.env },
})
child.unref()
console.log('spawned pid', child.pid)
