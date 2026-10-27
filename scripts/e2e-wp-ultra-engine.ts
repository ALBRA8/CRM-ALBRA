// E2E-ALBRA-WHATSPOWER-2026 — Parte C-3: engine real de ULTRA → daemon CRM (stub fiel)
// Mismo patrón que los tests oficiales del repo (businessDate inyectada para
// el anti-ban horario), pero con el HttpCrmDaemonDispatcher HTTP real apuntando
// al stub del daemon (contrato: Bearer INTERNAL_API_SECRET + {to,text}).
import { createServer } from 'node:http'
import { createBroadcastServer } from '/home/z/repos/WHATSPOWER-ULTRA/src/server.ts'
import { HttpCrmDaemonDispatcher } from '/home/z/repos/WHATSPOWER-ULTRA/src/adapters/dispatcher.ts'

const STUB_PORT = 3102
const DAEMON_SECRET = 'crm_albra_internal_secret_key_fixed_length_for_daemon_2026'
const PHONE = '573777888999'
const results: Array<{ id: string; pass: boolean; detail: string }> = []
function log(id: string, pass: boolean, detail: string) {
  results.push({ id, pass, detail })
  console.log(`${pass ? '✅' : '❌'} [${id}] ${detail}`)
}

const stubReceived: Array<{ to: string; text: string; auth: string }> = []
const stub = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${DAEMON_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No autorizado (INTERNAL_API_SECRET)' }))
      return
    }
    const parsed = JSON.parse(body)
    stubReceived.push({ to: parsed.to, text: parsed.text, auth: 'bearer-ok' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, messageId: `stub_wa_${Date.now()}` }))
  })
})

async function main() {
  await new Promise((r: any) => stub.listen(STUB_PORT, '127.0.0.1', r))

  // Server efímero con el DISPATCHER HTTP REAL hacia el stub del daemon
  const { server, engine } = createBroadcastServer({
    dbPath: ':memory:',
    dispatcher: new HttpCrmDaemonDispatcher({
      endpointUrl: `http://127.0.0.1:${STUB_PORT}/send`,
      secret: DAEMON_SECRET,
      allowRealDispatch: true, // el receptor es el stub E2E (no el puerto productivo 3002)
    }),
    whatsPowerEnabled: false,
  } as any)

  const campaign = await engine.createCampaign({
    organizationId: 'org-e2e-whatspower-crm-2026',
    name: 'E2E ULTRA→CRM dispatch real',
    templateSpintax: '{Hola|Buen día} {{nombre}}, mensaje E2E ULTRA→CRM (sin envío real).',
    csvContent: `phone,name\n${PHONE},E2E Ultra Lead 2026\n${PHONE},E2E Ultra Lead 2026 DUPLICADO`,
  } as any)

  // Dedup: 2 filas con el mismo teléfono → 1 destinatario
  log('C2b', 'Dedup de destinatarios duplicados (CSV 2 líneas → 1 target)', campaign.totalTargets === 1, `targets=${campaign.totalTargets}`)

  // Procesamiento con fecha dentro del horario comercial (08-18 Bogotá)
  const businessDate = new Date('2026-10-24T10:00:00-05:00')
  const step1 = await engine.processNextItem(campaign.id, businessDate)
  log('C3a', 'processNextItem (engine real) → SENT vía dispatcher HTTP', step1.processed === true && step1.status === 'SENT', `status=${step1.status} error=${step1.error ?? '—'}`)

  await new Promise((r) => setTimeout(r, 400))
  const sent = stubReceived.filter((r) => r.to.replace(/\D/g, '').includes(PHONE.slice(-9)))
  log(
    'C3b',
    sent.length === 1 && sent[0].auth === 'bearer-ok',
    `Contrato ULTRA→daemon: Bearer INTERNAL_API_SECRET + {to,text} — to=${sent[0]?.to ?? '—'} text="${(sent[0]?.text ?? '').slice(0, 55)}" auth=${sent[0]?.auth ?? '—'}`
  )

  // Idempotencia de items de campaña
  const stepAgain = await engine.processNextItem(campaign.id, businessDate)
  log('C3c', 'Campaña COMPLETED sin dobles envíos (1 target, 1 envío)', stepAgain.processed === false && stepAgain.status === 'COMPLETED' && stubReceived.length === 1, `final=${stepAgain.status} envíos_totales=${stubReceived.length}`)

  server.close()
  stub.close()
  const fails = results.filter((r) => !r.pass).length
  console.log(`\n=== PARTE C-3: ${results.length - fails}/${results.length} PASS ===`)
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })
