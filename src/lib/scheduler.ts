let intervalId: NodeJS.Timeout | null = null
let waDaemonStarted = false

export function startScheduler() {
  if (intervalId) return

  // Run immediately on start
  processDueAutomations()

  intervalId = setInterval(processDueAutomations, 60 * 1000)
  console.log('[Scheduler] Automation scheduler started (1min interval)')

  // Auto-start WhatsApp daemon if not already running
  startWhatsAppDaemon()
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/**
 * Auto-start the WhatsApp daemon process
 */
async function startWhatsAppDaemon() {
  if (waDaemonStarted) return
  waDaemonStarted = true

  // Check if daemon is already running
  try {
    const res = await fetch('http://localhost:3002/status')
    if (res.ok) {
      console.log('[Scheduler] WhatsApp daemon already running')
      return
    }
  } catch {
    // Daemon not running, start it
  }

  try {
    // Use eval to prevent Turbopack from statically analyzing the import
    // eslint-disable-next-line no-eval
    const cp = await eval('import("child_process")') as typeof import('child_process')
    const spawn = cp.spawn

    // Construct path at runtime only
    const parts = [process.cwd(), 'src', 'whatsapp-daemon', 'daemon.mjs']
    const daemonPath = parts.join('/')

    const daemon = spawn('node', [daemonPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })

    daemon.unref()
    console.log('[Scheduler] WhatsApp daemon auto-started')
  } catch (error) {
    console.error('[Scheduler] Failed to auto-start WhatsApp daemon:', error)
  }
}

async function processDueAutomations() {
  try {
    const secret = process.env.INTERNAL_API_SECRET || 'crm-albra-internal-2024'
    await fetch('http://localhost:3000/api/cron/process-automations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
    })
  } catch {
    // Server not ready or error
  }
}
