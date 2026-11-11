#!/usr/bin/env node
/**
 * (A2-23, auditoría 2026-11-11) Backfill de secretos de Telegram legados.
 *
 * Migra Integration.telegramSecret de TEXTO PLANO a:
 *   - telegramSecret = cifrado AES-256-GCM (misma clave que src/lib/crypto.ts)
 *   - telegramSecretHash = SHA-256 hex del valor en claro (lookup del webhook)
 *
 * Idempotente: las filas ya migradas (ciphertext `v1:` + hash presente) se
 * omiten. No destructiva: si una fila falla, se registra y se continúa.
 *
 * Uso:  node scripts/migrate-telegram-secrets.mjs
 * Requiere APP_ENCRYPTION_KEY o APP_SECRET y DATABASE_URL en el entorno.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

function getKey() {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.APP_SECRET
  if (!raw) {
    console.error('[migrate-telegram-secrets] APP_ENCRYPTION_KEY o APP_SECRET no configurados (openssl rand -hex 32).')
    process.exit(1)
  }
  return createHash('sha256').update(raw).digest()
}

function encryptSecret(plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

async function main() {
  const rows = await db.integration.findMany({
    where: { telegramSecret: { not: null } },
    select: { organizationId: true, telegramSecret: true, telegramSecretHash: true },
  })
  let migrated = 0
  let skipped = 0
  let failed = 0
  for (const row of rows) {
    const secret = row.telegramSecret ?? ''
    const alreadyEncrypted = secret.startsWith('v1:')
    const hasHash = !!row.telegramSecretHash
    if (alreadyEncrypted && hasHash) {
      skipped++
      continue
    }
    try {
      const plain = alreadyEncrypted ? secret : secret // valor en claro (decryptSecret devolvería el plano tal cual)
      const enc = alreadyEncrypted ? secret : encryptSecret(plain)
      const hash = createHash('sha256').update(plain).digest('hex')
      await db.integration.update({
        where: { organizationId: row.organizationId },
        data: { telegramSecret: enc, telegramSecretHash: hash },
      })
      migrated++
    } catch (err) {
      failed++
      console.error(`[migrate-telegram-secrets] org=${row.organizationId}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`[migrate-telegram-secrets] migradas=${migrated}, ya-migradas=${skipped}, fallos=${failed}, total=${rows.length}`)
}

main()
  .catch((err) => {
    console.error('[migrate-telegram-secrets] fallo fatal:', err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
