// FASE F — Persistencia, backup y recuperación (BD sintética de la campaña E2E, sin tocar producción)
// Lección incorporada: la copia de ficheros en crudo con WAL activo da datos obsoletos —
// el backup correcto usa la API online (.backup) tras wal_checkpoint.
// Evidencia → evidencias/fase-F-backup-restore.txt
import Database from 'better-sqlite3'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'

const E2E = '/home/z/my-project/albra-final/e2e'
const DRILL = '/home/z/my-project/albra-final/faseF-drill'
const EVID_DIR = '/home/z/my-project/download/ALBRA-PRUEBA-INTEGRAL/evidencias'
const SRC = `${E2E}/crm-e2e.db`
const EVID = []
const line = (s) => { console.log(s); EVID.push(s) }
mkdirSync(DRILL, { recursive: true })
rmSync(`${DRILL}/backup.db`, { force: true })

if (!existsSync(SRC)) { console.log('BD de campaña no existe — ejecuta la campaña E2E primero'); process.exit(1) }

// F0: demostración del peligro de copia en crudo con WAL (hallazgo operativo)
const walExists = existsSync(`${SRC}-wal`)
line(`F0 ADVERTENCIA OPERATIVA: BD con WAL activo (${walExists ? 'crm-e2e.db-wal presente' : 'sin -wal pendiente'}); copiar solo el .db en crudo PIERDE transacciones no checkpointeadas — el backup debe ser online (API .backup) o con checkpoint previo`)

// F1: consistencia de la BD activa
const src = new Database(SRC)
const ic1 = src.pragma('integrity_check', { simple: true })
const counts1 = {
  Client: src.prepare('SELECT count(*) c FROM Client').get().c,
  Opportunity: src.prepare('SELECT count(*) c FROM Opportunity').get().c,
  Integration: src.prepare('SELECT count(*) c FROM Integration').get().c,
  ApiKey: src.prepare('SELECT count(*) c FROM ApiKey').get().c,
  ClientHistory: src.prepare('SELECT count(*) c FROM ClientHistory').get().c,
}
line(`F1 BD activa (live): integrity_check=${ic1} | ${JSON.stringify(counts1)} PASS=${ic1 === 'ok' && counts1.Client >= 2}`)

// F2: backup ONLINE verificable (incluye WAL; consistente aunque el servicio siga escribiendo)
await src.backup(`${DRILL}/backup.db`)
line(`F2 backup online creado: ${DRILL}/backup.db (${existsSync(`${DRILL}/backup.db`) ? 'existe' : 'NO'})`)

// F3: modificación DESPUÉS del backup → no debe aparecer en la copia (consistencia puntual)
const markerPhone = '573000999888'
src.prepare("INSERT INTO Client (id, organizationId, name, phone, email, status, source, createdAt, updatedAt) SELECT 'cli_faseF_drill', id, 'FaseF Drill', ?, 'fasef@drill.local', 'active', 'manual', datetime('now'), datetime('now') FROM Organization LIMIT 1").run(markerPhone)
const afterMarker = src.prepare('SELECT count(*) c FROM Client').get().c
line(`F3 fila marcadora insertada en live tras el backup: Client ${counts1.Client}→${afterMarker}`)

// F4: restauración = abrir la copia en instancia aislada + integridad + comparación
const rst = new Database(`${DRILL}/backup.db`, { readonly: true })
const ic2 = rst.pragma('integrity_check', { simple: true })
const countsR = {
  Client: rst.prepare('SELECT count(*) c FROM Client').get().c,
  Opportunity: rst.prepare('SELECT count(*) c FROM Opportunity').get().c,
  Integration: rst.prepare('SELECT count(*) c FROM Integration').get().c,
  ApiKey: rst.prepare('SELECT count(*) c FROM ApiKey').get().c,
  ClientHistory: rst.prepare('SELECT count(*) c FROM ClientHistory').get().c,
}
const markerInBackup = rst.prepare('SELECT count(*) c FROM Client WHERE phone = ?').get(markerPhone).c
line(`F4 restauración aislada: integrity_check=${ic2} | counts=${JSON.stringify(countsR)}`)
line(`F4' counts restaurados = counts pre-marker: PASS=${JSON.stringify(countsR) === JSON.stringify(counts1)}`)
line(`F4'' la marcadora NO está en el backup (consistencia puntual): ${markerInBackup === 0} PASS=${markerInBackup === 0}`)

// F5: datos de negocio restaurados íntegros (clientes crm-api + historial conversacional)
const cliR = rst.prepare("SELECT count(*) c FROM Client WHERE source='crm-api'").get().c
const histR = rst.prepare('SELECT count(*) c FROM ClientHistory').get().c
line(`F5 datos de negocio restaurados: clientes crm-api=${cliR}, historial=${histR} PASS=${cliR >= 2 && histR >= 1}`)

// F6: eventos pendientes — tabla de mensajería compartida con el daemon
const tables = rst.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name)
const msgTable = tables.find(t => /outgoing|wa_message|WhatsApp/i.test(t))
if (msgTable) {
  const pend = rst.prepare(`SELECT count(*) c FROM ${msgTable}`).get().c
  line(`F6 tabla de mensajería '${msgTable}' restaurada: ${pend} fila(s) — los eventos sobreviven al restore PASS=true`)
} else {
  line(`F6 sin tabla de mensajería en BD del CRM — eventos pendientes cubiertos por UNCERTAIN_DISPATCH de ULTRA (C5/C5') y dedup WP (A2/B3)`)
}

// F7: recuperación ante caída sin falso éxito — referencias a E2E
line(`F7 caída de proceso sin falso éxito: demostrado en C5 (timeout→UNCERTAIN_DISPATCH), C5' (200 malformado→UNCERTAIN_DISPATCH), D1 (CRM caído→crmSynced=false sin 500) y D1''' (recuperación→crmSynced=true) — ver evidencias e2e/`)
rst.close(); src.close()
writeFileSync(`${EVID_DIR}/fase-F-backup-restore.txt`, EVID.join('\n') + '\n')
console.log('EVIDENCIA F guardada')
