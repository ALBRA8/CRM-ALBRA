// Arranca el Telegram Poller completamente desacoplado del shell padre (doble fork),
// igual que scripts/start-dev-detached.mjs. Log: scripts/logs/tg-poller.log
import { spawn } from 'child_process'
import { openSync } from 'fs'

const out = openSync('/home/z/my-project/scripts/logs/tg-poller.log', 'a')
const child = spawn('node', ['src/telegram-poller/poller.mjs'], {
  cwd: '/home/z/my-project',
  detached: true,
  stdio: ['ignore', out, out],
  env: { ...process.env },
})
child.unref()
console.log('spawned pid', child.pid)
