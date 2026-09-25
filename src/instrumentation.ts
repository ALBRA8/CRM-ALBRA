export async function register() {
  // Arranque del planificador durable al iniciar el servidor.
  // Ejecuta trabajos vencidos cada 60s de forma segura e idempotente.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { runDueJobs } = await import('./lib/scheduler')
    const tick = async () => {
      try {
        await runDueJobs()
      } catch (err) {
        // la BD puede no estar lista todavía en el arranque; ignorar silenciosamente
        console.error('[scheduler tick]', err instanceof Error ? err.message : err)
      }
    }
    setTimeout(tick, 15_000)
    setInterval(tick, 60_000)
  } catch (err) {
    console.error('[instrumentation] no se pudo iniciar el scheduler', err)
  }
}
