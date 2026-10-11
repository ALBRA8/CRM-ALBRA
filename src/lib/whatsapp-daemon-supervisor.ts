/**
 * Supervisor del daemon de WhatsApp (Baileys, puerto 3002).
 *
 * PROBLEMA QUE RESUELVE: el daemon se lanzaba manualmente (nohup/node) y en el
 * sandbox los procesos huérfanos son reapeados al terminar cada comando. El
 * único proceso estable de la plataforma es next-server, así que el daemon vive
 * como hijo de este proceso y se reinicia automáticamente si muere.
 *
 * - No hace doble spawn: sondea el puerto 3002 antes de arrancar.
 * - Backoff exponencial (5s → 60s) si el daemon falla repetidamente.
 * - Reset del backoff tras 5 min de uptime estable.
 * - WA_DAEMON_ENABLED=0 lo desactiva (escape hatch para CI/tests).
 *
 * ROOT CAUSE histórico (2026-10-01, "no me puedo conectar a WhatsApp"):
 * stdio pasaba un fs.WriteStream recién creado cuyo fd todavía era null
 * (el archivo se abre async) → spawn() lanzaba TypeError síncrono → el
 * .catch(() => {}) del tick lo tragaba → el supervisor "giraba en falso"
 * cada 10s sin spawnear nada, sin logs y con el backoff congelado
 * (lastStartAt nunca se actualizaba). Lecciones aplicadas:
 *  1. stdio con fd ENTERO abierto por openSync (determinista, sin carrera).
 *  2. Todos los fallos de spawn se registran en daemon.log y stderr.
 *  3. lastStartAt se actualiza SIEMPRE (finally) para un backoff real.
 *  4. Liveness verificado con kill(pid, 0): el 'exit' puede no llegar
 *     (SIGKILL al grupo por el reaper del sandbox, zombies).
 */
import { spawn, type ChildProcess } from 'child_process'
import net from 'net'
import path from 'path'

const DAEMON_PORT = 3002
const STABLE_RESET_MS = 5 * 60 * 1000

let child: ChildProcess | null = null
let restarts = 0
let lastStartAt = 0
let monitoring = false

/** Logging síncrono al archivo compartido con el daemon (baja frecuencia). */
function logLine(root: string, msg: string) {
  const line = `[supervisor] ${new Date().toISOString()} ${msg}\n`
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    fs.appendFileSync(path.join(root, 'daemon.log'), line)
  } catch {}
  // Visible en el log del servidor Next (dev.log / stdout del contenedor)
  console.error(line.trim())
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(1200)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
}

/** El 'exit' puede no llegar (SIGKILL al grupo, zombies): verificación directa. */
function isChildAlive(c: ChildProcess | null): boolean {
  if (!c || !c.pid) return false
  if (c.exitCode !== null || c.signalCode !== null) return false
  try {
    process.kill(c.pid, 0) // señal 0: solo prueba de existencia
    return true
  } catch {
    return false
  }
}

function spawnDaemon(): boolean {
  const root = process.cwd()
  const script = path.join(root, 'src', 'whatsapp-daemon', 'daemon.mjs')
  const logPath = path.join(root, 'daemon.log')

  // En build standalone el daemon no está incluido: no intentar spawn.
  // (en producción el daemon se lanza aparte con `npm run wa:daemon`)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    if (!fs.existsSync(script)) return false
  } catch {
    return false
  }

  logLine(root, `spawn del daemon (intento ${restarts + 1})`)

  // fd ENTERO y síncrono: fs.WriteStream con fd=null (apertura async) hacía
  // que spawn lanzara "The argument 'stdio' is invalid" — el bug original.
  let logFd: number | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    logFd = fs.openSync(logPath, 'a')
    child = spawn(process.execPath, [script], {
      cwd: root,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    })
  } catch (err) {
    // FAIL-LOUD: antes esto se tragaba y el supervisor giraba en falso.
    logLine(root, `ERROR al spawnear el daemon: ${err instanceof Error ? err.stack || err.message : String(err)}`)
    child = null
    return false
  } finally {
    if (logFd !== null) {
      try {
        // El hijo recibió su propio dup del fd; cerrar la copia del padre.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ;(require('fs') as typeof import('fs')).closeSync(logFd)
      } catch {}
    }
    // Backoff correcto aunque spawn lance: cuenta como intento hecho.
    lastStartAt = Date.now()
  }

  child.on('exit', (code, signal) => {
    logLine(root, `daemon salió (code=${code} signal=${signal})`)
    child = null
  })
  child.on('error', (err) => {
    logLine(root, `error del proceso daemon: ${err.message}`)
    child = null
  })
  return true
}

async function ensureAlive() {
  if (isChildAlive(child)) return
  if (child) {
    // Hijo zombi o muerto sin evento 'exit': limpiar para poder respawnear.
    logLine(process.cwd(), 'hijo del daemon muerto sin evento exit — limpieza y respawn')
    child = null
  }
  const portBusy = await isPortOpen(DAEMON_PORT)
  if (portBusy) {
    // Hay un daemon sano (o un proceso ajeno) en 3002: no duplicar.
    // Si deja de responder, el próximo tick lo arrancará.
    return
  }
  // Backoff exponencial entre reintentos
  const stableFor = Date.now() - lastStartAt
  if (lastStartAt > 0 && stableFor < STABLE_RESET_MS && restarts > 0) {
    const wait = Math.min(5000 * 2 ** Math.min(restarts - 1, 4), 60_000)
    if (stableFor < wait) return
  } else if (lastStartAt > 0 && stableFor >= STABLE_RESET_MS) {
    restarts = 0
  }
  restarts += 1
  spawnDaemon()
}

export function superviseWhatsAppDaemon() {
  if (process.env.WA_DAEMON_ENABLED === '0') return
  if (monitoring) return
  monitoring = true

  // Arranque diferido: da tiempo a que un daemon externo tome el puerto
  // (p. ej. `npm run wa:daemon` en producción) antes de asumir el control.
  setTimeout(() => {
    ensureAlive().catch((err) => console.error('[supervisor] tick falló:', err?.message || err))
    setInterval(() => {
      ensureAlive().catch((err) => console.error('[supervisor] tick falló:', err?.message || err))
    }, 10_000)
  }, 8_000)
}
