/**
 * Prueba automatizada de la migración destructiva zzzzzzzzz_drop_legacy_channel_models
 * (hallazgo A-010: json_extract sobre columnas cifradas "v1:iv:tag:datos" abortaba
 * con "malformed JSON").
 *
 * Método (independiente de Prisma y de la BD global de tests):
 *  1. Construye una base SQLite EFÍMERA en tmp y aplica TODAS las migraciones
 *     hasta antes de las dos finales (zzzzzzzz_canonical_channel_expand y
 *     zzzzzzzzz_drop_legacy_channel_models), en el mismo orden lexicográfico
 *     que usa Prisma.
 *  2. Siembra datos legacy REALISTAS de los 3 generaciones: WhatsApp Cloud
 *     (WhatsAppConnection + Integration), Baileys (WhatsAppConversation/Message),
 *     Google, Telegram, Instagram, Facebook (dos filas: con y sin facebookPageId)
 *     y TikTok. Todos los tokens en formato cifrado v1:<iv>:<tag>:<datos> que
 *     NO es JSON (exactamente lo que produce encryptSecret / src/lib/crypto.ts).
 *  3. Aplica las dos migraciones finales y verifica: migración OK, tablas legacy
 *     eliminadas, conteos correctos de ChannelConnection/Conversation/Message,
 *     texto de mensajes intacto, blobs cifrados copiados byte a byte, constancia
 *     de la fila Facebook no migrada y PRAGMA integrity_check/foreign_key_check
 *     limpios.
 *
 * Antes de la corrección esta prueba fallaba con "malformed JSON" al aplicar
 * la migración destructiva; después pasa completa.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'prisma', 'migrations')
const EXPAND = 'zzzzzzzz_canonical_channel_expand'
const DROP = 'zzzzzzzzz_drop_legacy_channel_models'

/** Orden lexicográfico de directorios de migración, igual que Prisma. */
function listMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function readMigrationSql(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')
}

/** Blob cifrado REALISTA en el formato de encryptSecret (AES-256-GCM): v1:iv:tag:datos.
 *  Base64 aleatorio: nunca es JSON válido (sin llaves) — reproduce el bug A-010. */
function v1Blob(): string {
  return `v1:${randomBytes(12).toString('base64')}:${randomBytes(16).toString('base64')}:${randomBytes(48).toString('base64')}`
}

/** SQL ejecutable sin comentarios (para auditoría estática de json_extract). */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

const ORG_A = 'org_test_a'
const ORG_B = 'org_test_b'

// Datos sintéticos (sin datos personales): teléfonos ficticios del rango
// autorizado por el repo (573000000xxx) e IDs numéricos de marcador.
const GOOGLE_RT = v1Blob()
const GOOGLE_CLIENT_JSON = v1Blob()
const AGENT_LEADS = v1Blob()
const WA_CLOUD_TOKEN = v1Blob()
const WA_INT_TOKEN = v1Blob()
const TG_TOKEN = v1Blob()
const IG_TOKEN = v1Blob()
const FB_TOKEN_WITH_PAGE = v1Blob()
const FB_TOKEN_NO_PAGE = v1Blob()
const TT_TOKEN = v1Blob()
const WA_CONNECTION_ID = 'wac_test_1'
const WA_PHONE_ID = '1000000000001'
const WA_INT_PHONE_ID = '1000000000002'
const IG_ACCOUNT = '17840000000000'
const FB_PAGE_ID = '100000000000001'
const MSG_TEXTS = [
  'Hola, ¿tienen disponibilidad para el plan mensual?',
  'Buenas tardes, sí hay disponibilidad. ¿Desea reservar?',
  'Sí, para mañana a las 10 am.',
]

let dbPath: string
let db: DatabaseSync

function applyMigration(name: string): void {
  db.exec(readMigrationSql(name))
}

function count(table: string, where = ''): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" ${where}`).get() as { n: number }
  return Number(row.n)
}

describe('migración zzzzzzzzz_drop_legacy_channel_models con datos legacy cifrados (A-010)', () => {
  beforeAll(() => {
    const migrations = listMigrations()
    const idxExpand = migrations.indexOf(EXPAND)
    const idxDrop = migrations.indexOf(DROP)
    expect(idxExpand, 'la migración expand debe existir en prisma/migrations').toBeGreaterThan(-1)
    expect(idxDrop, 'la migración drop debe existir en prisma/migrations').toBeGreaterThan(idxExpand)

    dbPath = path.join(os.tmpdir(), `crm-mig-test-${Date.now()}-${randomBytes(4).toString('hex')}.db`)
    db = new DatabaseSync(dbPath)

    // 1) TODAS las migraciones hasta antes de las dos finales.
    for (const name of migrations.slice(0, idxExpand)) applyMigration(name)

    // 2) Semilla legacy REALISTA (2 organizaciones para verificar aislamiento).
    const ins = (sql: string, params: (string | number | null)[]) =>
      db.prepare(sql).run(...params)

    ins(
      `INSERT INTO "Organization" ("id", "name", "slug", "updatedAt") VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [ORG_A, 'Org Prueba A', 'org-prueba-a']
    )
    ins(
      `INSERT INTO "Organization" ("id", "name", "slug", "updatedAt") VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [ORG_B, 'Org Prueba B', 'org-prueba-b']
    )
    ins(
      `INSERT INTO "Settings" ("id", "organizationId", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)`,
      ['set_test_a', ORG_A]
    )

    // Integration org A: google, telegram, instagram, whatsapp cloud 1:1,
    // facebook CON pageId, tiktok y secret agent-leads (todos blobs v1:*).
    ins(
      `INSERT INTO "Integration" ("id", "organizationId", "telegramBotTokenEnc", "telegramSecretHash", "instagramTokenEnc", "instagramAccountId",
        "googleRefreshTokenEnc", "googleClientJsonEnc", "googleEmail", "whatsappPhoneId", "whatsappCloudTokenEnc", "agentLeadsSecretEnc",
        "facebookTokenEnc", "facebookPageId", "facebookPageName", "tiktokTokenEnc",
        "enableWhatsApp", "enableTelegram", "enableInstagram", "enableFacebook", "enableTikTok", "enableGoogle", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, CURRENT_TIMESTAMP)`,
      [
        'int_test_a', ORG_A, TG_TOKEN, 'tg_hash_test_a', IG_TOKEN, IG_ACCOUNT,
        GOOGLE_RT, GOOGLE_CLIENT_JSON, 'demo@example.test', WA_INT_PHONE_ID, WA_INT_TOKEN, AGENT_LEADS,
        FB_TOKEN_WITH_PAGE, FB_PAGE_ID, 'Página Demo', TT_TOKEN,
      ]
    )
    // Integration org B: facebook CON token pero SIN facebookPageId → antes del
    // fix abortaba; ahora NO se migra y queda constancia en ChannelConnectionEvent.
    ins(
      `INSERT INTO "Integration" ("id", "organizationId", "facebookTokenEnc", "enableFacebook", "updatedAt")
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)`,
      ['int_test_b', ORG_B, FB_TOKEN_NO_PAGE]
    )

    // WhatsApp Cloud por organización (oleada 2).
    ins(
      `INSERT INTO "WhatsAppConnection" ("id", "organizationId", "wabaId", "phoneNumberId", "phoneNumber", "displayName",
        "accessTokenEnc", "webhookVerifyToken", "status", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', CURRENT_TIMESTAMP)`,
      [WA_CONNECTION_ID, ORG_A, '1000000000000', WA_PHONE_ID, '573000000001', 'Ventas Demo', WA_CLOUD_TOKEN, 'verify_token_test']
    )
    ins(
      `INSERT INTO "WhatsAppConnectionEvent" ("id", "organizationId", "connectionId", "type", "detail") VALUES (?, ?, ?, 'connected', 'seed')`,
      ['wace_test_1', ORG_A, WA_CONNECTION_ID]
    )

    // Baileys (generación 1): conversaciones y mensajes en org A y org B.
    const convA = 'conv_test_a'
    const convB = 'conv_test_b'
    ins(
      `INSERT INTO "WhatsAppConversation" ("id", "organizationId", "contactPhone", "contactName", "lastMessage", "lastMessageAt",
        "lastMessageFrom", "unreadCount", "isAutoReply", "status", "updatedAt")
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 2, 1, 'active', CURRENT_TIMESTAMP)`,
      [convA, ORG_A, '573000000001', 'Contacto Demo', MSG_TEXTS[2], 'contact']
    )
    ins(
      `INSERT INTO "WhatsAppConversation" ("id", "organizationId", "contactPhone", "contactName", "lastMessage", "lastMessageAt",
        "lastMessageFrom", "unreadCount", "isAutoReply", "status", "updatedAt")
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0, 0, 'active', CURRENT_TIMESTAMP)`,
      [convB, ORG_B, '573000000002', 'Contacto Demo B', 'Listo, gracias', 'agent']
    )
    const dirs = ['inbound', 'outbound', 'inbound']
    const senders = ['contact', 'agent', 'contact']
    for (let i = 0; i < MSG_TEXTS.length; i++) {
      ins(
        `INSERT INTO "WhatsAppMessage" ("id", "organizationId", "conversationId", "waMessageId", "direction",
          "fromNumber", "toNumber", "text", "messageType", "senderType", "isRead", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, 0, CURRENT_TIMESTAMP)`,
        [`wm_test_${i + 1}`, ORG_A, convA, `wamid.test.${i + 1}`, dirs[i], '573000000001', '573000000099', MSG_TEXTS[i], senders[i]]
      )
    }

    // 3) Las dos migraciones finales, en orden de producción: expand → drop.
    applyMigration(EXPAND)
    applyMigration(DROP)
  })

  afterAll(() => {
    try { db?.close() } catch { /* ya cerrada */ }
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true })
    }
  })

  it('A1 — las dos migraciones finales se aplican sin error (antes del fix: "malformed JSON")', () => {
    // El error "malformed JSON" abortaba beforeAll; llegar aquí ya prueba el fix.
    expect(db.isOpen).toBe(true)
  })

  it('A2 — las 5 tablas legacy quedaron eliminadas', () => {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of ['Integration', 'WhatsAppConnection', 'WhatsAppConnectionEvent', 'WhatsAppConversation', 'WhatsAppMessage']) {
      expect(names).not.toContain(t)
    }
  })

  it('A3 — Google migró a GoogleIntegration con blobs intactos', () => {
    expect(count('GoogleIntegration')).toBe(1)
    const g = db.prepare(`SELECT * FROM "GoogleIntegration"`).get() as Record<string, unknown>
    expect(g.organizationId).toBe(ORG_A)
    expect(g.googleRefreshTokenEnc).toBe(GOOGLE_RT)
    expect(g.googleClientJsonEnc).toBe(GOOGLE_CLIENT_JSON)
    expect(g.googleEmail).toBe('demo@example.test')
    expect(Number(g.calendarSyncEnabled)).toBe(1)
  })

  it('A4 — agentLeadsSecretEnc copiado de Integration a Settings', () => {
    const s = db.prepare(`SELECT "agentLeadsSecretEnc" FROM "Settings" WHERE "organizationId" = ?`).get(ORG_A) as { agentLeadsSecretEnc: string }
    expect(s.agentLeadsSecretEnc).toBe(AGENT_LEADS)
  })

  it('A5 — ChannelConnection: 8 filas con las claves de proveedor exactas', () => {
    expect(count('ChannelConnection')).toBe(8)
    const keys = (db.prepare(`SELECT "providerAccountKey", "organizationId", "provider", "channel", "status" FROM "ChannelConnection"`).all() as Record<string, unknown>[])
    const byKey = new Map(keys.map((r) => [r.providerAccountKey as string, r]))
    const expected = [
      [`meta:whatsapp:${WA_PHONE_ID}`, ORG_A, 'meta_cloud', 'whatsapp', 'connected'],
      [`meta:whatsapp:${WA_INT_PHONE_ID}`, ORG_A, 'meta_cloud', 'whatsapp', 'connected'],
      [`telegram:org:${ORG_A}`, ORG_A, 'telegram_bot', 'telegram', 'connected'],
      [`meta:instagram:${IG_ACCOUNT}`, ORG_A, 'meta_graph', 'instagram', 'connected'],
      [`meta:messenger:${FB_PAGE_ID}`, ORG_A, 'meta_graph', 'messenger', 'connected'],
      [`tiktok:business:${ORG_A}`, ORG_A, 'tiktok_business', 'tiktok', 'connected'],
      [`whatsapp_baileys:${ORG_A}`, ORG_A, 'whatsapp_baileys', 'whatsapp', 'connected'],
      [`whatsapp_baileys:${ORG_B}`, ORG_B, 'whatsapp_baileys', 'whatsapp', 'connected'],
    ] as const
    for (const [key, org, provider, channel, status] of expected) {
      const row = byKey.get(key)
      expect(row, `falta la conexión ${key}`).toBeTruthy()
      expect(row?.organizationId).toBe(org)
      expect(row?.provider).toBe(provider)
      expect(row?.channel).toBe(channel)
      expect(row?.status).toBe(status)
    }
  })

  it('A6 — blobs cifrados copiados byte a byte (WhatsApp Cloud, Telegram y TikTok)', () => {
    const wa = db.prepare(`SELECT "credentialsEnc" FROM "ChannelConnection" WHERE "providerAccountKey" = ?`).get(`meta:whatsapp:${WA_PHONE_ID}`) as { credentialsEnc: string }
    expect(wa.credentialsEnc).toBe(WA_CLOUD_TOKEN)
    // Telegram: el NOT NULL de externalAccountId dejaba la fila sin migrar en
    // silencio (INSERT OR IGNORE tragaba la violación). Ahora: placeholder orgId
    // + webhookSecretHash copiado + blob intacto; el backfill TS rellena el botId.
    const tg = db.prepare(`SELECT * FROM "ChannelConnection" WHERE "providerAccountKey" = ?`).get(`telegram:org:${ORG_A}`) as Record<string, unknown>
    expect(tg.credentialsEnc).toBe(TG_TOKEN)
    expect(tg.externalAccountId).toBe(ORG_A)
    expect(tg.webhookSecretHash).toBe('tg_hash_test_a')
    const tgMeta = JSON.parse(tg.metadata as string) as Record<string, unknown>
    expect(tgMeta.pendingDecrypt).toBe('botId')
    // TikTok: blob intacto y pendingDecrypt declarado.
    const tt = db.prepare(`SELECT "credentialsEnc" FROM "ChannelConnection" WHERE "providerAccountKey" = ?`).get(`tiktok:business:${ORG_A}`) as { credentialsEnc: string }
    expect(tt.credentialsEnc).toBe(TT_TOKEN)
  })

  it('A7 — Facebook CON pageId: migrado con identidad plana (sin leer el blob)', () => {
    const row = db.prepare(`SELECT * FROM "ChannelConnection" WHERE "providerAccountKey" = ?`).get(`meta:messenger:${FB_PAGE_ID}`) as Record<string, unknown>
    expect(row.externalAccountId).toBe(FB_PAGE_ID)
    expect(row.displayName).toBe('Página Demo')
    expect(row.credentialsEnc).toBe(FB_TOKEN_WITH_PAGE)
    const meta = JSON.parse(row.metadata as string) as Record<string, unknown>
    expect(meta.legacyBackfill).toBe('Integration.facebook')
  })

  it('A8 — Facebook SIN pageId: NO migrado y con constancia en ChannelConnectionEvent', () => {
    // Ninguna conexión de messenger adicional (el blob no puede dar la identidad).
    expect(count('ChannelConnection', `WHERE "channel" = 'messenger'`)).toBe(1)
    const events = db.prepare(`SELECT * FROM "ChannelConnectionEvent" WHERE "type" = 'migration_backfill_skipped'`).all() as Record<string, unknown>[]
    expect(events.length).toBe(1)
    expect(events[0].organizationId).toBe(ORG_B)
    expect(events[0].connectionId).toBeNull()
    const detail = JSON.parse(events[0].detail as string) as Record<string, unknown>
    expect(detail.reason).toBe('missing_facebookPageId')
    expect(detail.legacyTable).toBe('Integration')
    // El detalle jamás contiene secretos: no debe contener el blob cifrado.
    expect(String(events[0].detail)).not.toContain('v1:')
  })

  it('A9 — TikTok: clave estable por organización y blob cifrado intacto', () => {
    const row = db.prepare(`SELECT * FROM "ChannelConnection" WHERE "providerAccountKey" = ?`).get(`tiktok:business:${ORG_A}`) as Record<string, unknown>
    expect(row.externalAccountId).toBe(ORG_A) // placeholder; el backfill TS rellena openId
    expect(row.displayName).toBeNull()
    expect(row.credentialsEnc).toBe(TT_TOKEN)
    const meta = JSON.parse(row.metadata as string) as Record<string, unknown>
    expect(meta.legacyBackfill).toBe('Integration.tiktok')
    expect(meta.pendingDecrypt).toBe('openId,displayName')
  })

  it('A10 — conversaciones canónicas: 2, una por organización, aisladas por tenant', () => {
    expect(count('ChannelConversation')).toBe(2)
    const a = db.prepare(`SELECT * FROM "ChannelConversation" WHERE "organizationId" = ?`).get(ORG_A) as Record<string, unknown>
    expect(a.externalContactKey).toBe('573000000001')
    expect(a.contactName).toBe('Contacto Demo')
    expect(a.lastMessage).toBe(MSG_TEXTS[2])
    expect(String(a.connectionId)).toBe(`conn_baileys_${ORG_A}`)
    const meta = JSON.parse(a.metadata as string) as Record<string, unknown>
    expect(meta.clientId).toBeNull()
    // SQLite: (w."isAutoReply" != 0) produce entero 1/0 y json_object lo serializa
    // como número; el daemon puede seguir usando booleanos en filas nuevas.
    expect(meta.isAutoReply).toBe(1)
    const b = db.prepare(`SELECT * FROM "ChannelConversation" WHERE "organizationId" = ?`).get(ORG_B) as Record<string, unknown>
    expect(b.externalContactKey).toBe('573000000002')
    expect(String(b.connectionId)).toBe(`conn_baileys_${ORG_B}`)
  })

  it('A11 — mensajes canónicos: 3, texto intacto (acentos incluidos) y dedup por waMessageId', () => {
    expect(count('ChannelMessage')).toBe(3)
    const rows = db.prepare(`SELECT * FROM "ChannelMessage" ORDER BY "createdAt" ASC, "id" ASC`).all() as Record<string, unknown>[]
    const bodies = rows.map((r) => r.body)
    expect(bodies).toEqual(MSG_TEXTS)
    expect(rows.map((r) => r.direction)).toEqual(['in', 'out', 'in'])
    expect(rows.map((r) => r.externalMessageId)).toEqual(['wamid.test.1', 'wamid.test.2', 'wamid.test.3'])
    const meta0 = JSON.parse(rows[0].metadata as string) as Record<string, unknown>
    expect(meta0.from).toBe('573000000001')
    expect(meta0.to).toBe('573000000099')
  })

  it('A12 — la migración destructiva no contiene json_extract ejecutable', () => {
    const sql = stripSqlComments(readMigrationSql(DROP))
    expect(sql).not.toContain('json_extract(')
    // Los únicos usos de JSON deben ser json_object (constructor, nunca parser).
    expect(sql).toContain('json_object(')
  })

  it('A13 — PRAGMA integrity_check y foreign_key_check limpios', () => {
    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
    expect(integrity).toBe('ok')
    const fk = db.prepare('PRAGMA foreign_key_check').all()
    expect(fk).toEqual([])
  })
})
