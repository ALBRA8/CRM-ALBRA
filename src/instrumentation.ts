export async function register() {
  // Arranque del planificador durable al iniciar el servidor.
  // Ejecuta trabajos vencidos cada 60s de forma segura e idempotente.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // P0.4 — Fail-fast de secretos: el servidor de PRODUCCIÓN no arranca con
  // secretos de ejemplo, marcadores sin reemplazar, vacíos, cortos o de baja
  // entropía. En desarrollo solo advierte. Se omite durante `next build`
  // (NEXT_PHASE=phase-production-build): ahí no se sirve nada todavía.
  try {
    const { assertEnvForProduction } = await import('./lib/env-guard')
    assertEnvForProduction()
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    const building = process.env.NEXT_PHASE === 'phase-production-build'
    if (process.env.NODE_ENV === 'production' && !building) {
      process.exit(1) // producción con secretos inválidos: morir aquí, no servir
    }
  }

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
