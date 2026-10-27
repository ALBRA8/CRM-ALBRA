// E2E-ALBRA-WHATSPOWER-2026 — Parte C-4: salvaguarda anti-ban de ULTRA
// Usa el HttpCrmDaemonDispatcher REAL de WHATSPOWER-ULTRA contra:
//   a) el daemon productivo del CRM (:3002) sin autorización de envío → guard
//   b) el daemon productivo con autorización pero WhatsApp desconectado → error controlado
import { HttpCrmDaemonDispatcher } from '/home/z/repos/WHATSPOWER-ULTRA/src/adapters/dispatcher.ts'

const DAEMON_SECRET = 'crm_albra_internal_secret_key_fixed_length_for_daemon_2026'
const PHONE = '573777888999'
const results: Array<{ id: string; pass: boolean; detail: string }> = []
function log(id: string, pass: boolean, detail: string) {
  results.push({ id, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${detail}`)
}

async function main() {
  // a) guard físico
  const guarded = new HttpCrmDaemonDispatcher({ endpointUrl: 'http://localhost:3002/send', secret: DAEMON_SECRET, allowRealDispatch: false })
  const guardRes = await guarded.dispatch(PHONE, 'E2E intento de envío real (debe ser bloqueado)')
  log(
    'C4',
    guardRes.success === false && String(guardRes.error).includes('DISPATCH_BLOCKED_BY_SAFETY_GUARD'),
    `Guard anti-ban: dispatch a :3002 bloqueado sin ALLOW_REAL_DISPATCH — success=${guardRes.success} error=${String(guardRes.error).slice(0, 80)}`
  )

  // b) daemon real no conectado (WhatsApp sin vincular) → error controlado, sin colgar
  const real = new HttpCrmDaemonDispatcher({ endpointUrl: 'http://localhost:3002/send', secret: DAEMON_SECRET, allowRealDispatch: true })
  const t0 = Date.now()
  const realRes = await real.dispatch(PHONE, 'E2E contra daemon real (no conectado → error controlado)')
  const dt = Date.now() - t0
  log(
    'C4b',
    realRes.success === false && dt < 6000,
    `Daemon real no disponible → error controlado sin proceso colgado — success=${realRes.success} error=${String(realRes.error).slice(0, 70)} latencia=${dt}ms`
  )

  const fails = results.filter((r) => !r.pass).length
  console.log(`\n=== PARTE C-4: ${results.length - fails}/${results.length} PASS ===`)
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })
