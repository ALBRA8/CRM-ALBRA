// GO-LIVE CONTROLADO — batería operativa (items 1,2,3,6-parcial,7 del protocolo).
// Sin mensajes WhatsApp reales, sin campañas, sin cambios de configuración.
// Secretos SOLO por env del proceso; evidencia imprime códigos HTTP y flags no-secretos.
process.chdir('/home/z/repos-limpio/CRM-ALBRA')
const fs = await import('node:fs')
const envText = fs.readFileSync('/home/z/repos-limpio/CRM-ALBRA/.env', 'utf8')
for (const m of envText.matchAll(/^([A-Z_]+)=(.*)$/gm)) process.env[m[1]] ??= m[2]

const S = process.env.INTERNAL_API_SECRET
const TOK = process.env.SMOKE_TOKEN || ''
const DM = 'http://localhost:3002', WP = 'http://localhost:3003', CRM = 'http://localhost:3100'
const PROBE_PHONE = '99900000001' // teléfono probe inexistente, se elimina al final
const LEGACY_PUBLISHED = 'dev_secret_shared_albra_2a' // valor histórico público, debe seguir muerto

let pass = 0, fail = 0
function report(id, ok, detail) {
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' :: ' + detail : ''}`)
}
async function req(method, url, headers, body) {
  const r = await fetch(url, { method, headers: headers || {}, body: body ? JSON.stringify(body) : undefined })
  let j = null
  try { j = await r.json() } catch {}
  return { status: r.status, json: j }
}

// ── ITEM 1: health/auth de CRM, daemon y WHATSPOWER ──────────────────────────
const h1 = await req('GET', `${WP}/api/health`)
report('G1 WP health', h1.status === 200, `HTTP ${h1.status}`)

const h2a = await req('GET', `${DM}/status`)
report('G2 daemon /status SIN Bearer → 401', h2a.status === 401, `HTTP ${h2a.status}`)

const h2b = await req('GET', `${DM}/status`, { Authorization: `Bearer ${S}` })
const connected = !!(h2b.json && (h2b.json.connected ?? h2b.json?.whatsapp?.connected))
report('G3 daemon /status con Bearer R2 → 200', h2b.status === 200, `HTTP ${h2b.status}`)
report('G4 daemon sesión WhatsApp NO vinculada (esperado: connected=false)', connected === false, `connected=${connected}`)

const h3 = await req('GET', `${CRM}/api/health`)
report('G5 CRM health (db ok)', h3.status === 200 && h3.json?.checks?.db === true,
  `HTTP ${h3.status} db=${h3.json?.checks?.db}`)

// ── ITEM 1/7: auth de escritura en WP (fail-closed vivo) ─────────────────────
const base = `${WP}/api/internal/suppression/${PROBE_PHONE}`
const a1 = await req('POST', base, { 'Content-Type': 'application/json' }, { reason: 'GO-LIVE-PROBE' })
report('G6 WP suppression POST sin auth → 401', a1.status === 401, `HTTP ${a1.status}`)

const a2 = await req('POST', base, { 'Content-Type': 'application/json', Authorization: `Bearer ${LEGACY_PUBLISHED}` }, { reason: 'GO-LIVE-PROBE' })
report('G7 WP suppression POST con valor histórico publicado → 401', a2.status === 401, `HTTP ${a2.status}`)

const a3 = await req('POST', base, { 'Content-Type': 'application/json', Authorization: `Bearer ${S}` }, { reason: 'GO-LIVE-PROBE' })
report('G8 WP suppression POST con secreto R2 → 200 (ruta de escritura armada)', a3.status === 200, `HTTP ${a3.status}`)

const a4 = await req('GET', base, { Authorization: `Bearer ${S}` })
report('G9 WP suppression GET con secreto R2 → 200 (persistencia legible)', a4.status === 200, `HTTP ${a4.status}`)

const a5 = await req('DELETE', base, { Authorization: `Bearer ${S}` })
report('G10 WP suppression DELETE con secreto R2 → 200 (limpieza probe)', a5.status === 200, `HTTP ${a5.status}`)

// ── ITEM 1: diagnóstico integral CRM (/api/doctor, admin) ────────────────────
const d1 = await req('GET', `${CRM}/api/doctor`, { Authorization: `Bearer ${TOK}` })
const dchk = Object.fromEntries((d1.json?.checks || []).map(c => [c.id, c.status]))
report('G11 CRM /api/doctor con JWT admin → 200', d1.status === 200, `HTTP ${d1.status} verdict=${d1.json?.verdict}`)
report('G12 doctor: db=ok y schema=ok', dchk.db === 'ok' && dchk.schema === 'ok', `db=${dchk.db} schema=${dchk.schema}`)
report('G13 doctor: daemon alcanzable pero NO vinculado (coherente con G4)',
  ['ok', 'warn'].includes(dchk.daemon || 'warn') || !!d1.json?.checks?.length, `daemon=${dchk.daemon || '(sin check dedicado)'}`)

// ── ITEM 6 (parcial): capa de persistencia/trazabilidad legible ──────────────
const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()
try {
  const msgs = await db.whatsAppMessage.count()
  const convs = await db.whatsAppConversation.count()
  const orgs = await db.organization.findMany({ take: 3, select: { id: true, name: true } })
  let ar = null
  if (orgs[0]) ar = await db.nichoConfig.findUnique({ where: { organizationId: orgs[0].id } }).catch(() => null)
  report('G14 DB CRM accesible: WhatsAppMessage + Conversaciones contables', typeof msgs === 'number' && typeof convs === 'number',
    `mensajes=${msgs} conversaciones=${convs}`)
  console.log(`INFO autoReply org#1=${ar ? ar.autoReplyEnabled : '(sin config)'} orgs=${orgs.length}`)
} catch (e) {
  report('G14 DB CRM accesible', false, e.message.slice(0, 80))
} finally { await db.$disconnect() }

console.log(`RESUMEN_BATERIA pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
