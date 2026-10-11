// Arranca next dev completamente desacoplado del shell padre (doble fork)
import { spawn } from 'child_process'
import { openSync } from 'fs'

const out = openSync('/home/z/my-project/dev.log', 'a')
const child = spawn('npm', ['run', 'dev'], {
  cwd: '/home/z/my-project',
  detached: true,
  stdio: ['ignore', out, out],
})
child.unref()
console.log('spawned pid', child.pid)
